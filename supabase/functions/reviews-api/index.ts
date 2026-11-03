// moda24.online — API відгуків. Сайт звертається тільки сюди; ключі Supabase живуть лише на сервері.
//  GET  ?a=ratings | ?a=product&uid=…&offset=&rating=&fit= | ?a=latest&offset=
//  POST ?a=submit (JSON) | ?a=photo&id=…&k=… (FormData) | ?a=vote (JSON {id, v})
// Відгук без фото не потрапляє на сайт: схвалити його не дасть база (тригер reviews_require_photo).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEY = (() => {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const o = JSON.parse(raw);
      return o.default ?? Object.values(o)[0];
    } catch { /* fallthrough */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
})() as string;

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://moda24.online,https://www.moda24.online")
  .split(",").map((s) => s.trim()).filter(Boolean);

const BUCKET = "review-photos";
const PAGE_MAX = 12;
const MAX_PHOTOS = 5;

const db = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cache = new Map<string, { exp: number; body: string }>();
async function cached(key: string, ttlSec: number, fn: () => Promise<unknown>) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.body;
  try {
    const body = JSON.stringify(await fn());
    cache.set(key, { exp: now + ttlSec * 1000, body });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return body;
  } catch (e) {
    if (hit) return hit.body;
    throw e;
  }
}

const ipHits = new Map<string, { t: number; n: number }>();
function softLimit(ip: string, max = 120, windowMs = 60_000) {
  const now = Date.now();
  const r = ipHits.get(ip);
  if (!r || now - r.t > windowMs) { ipHits.set(ip, { t: now, n: 1 }); return true; }
  r.n++;
  if (ipHits.size > 5000) ipHits.clear();
  return r.n <= max;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { "Vary": "Origin" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "content-type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}
function reply(body: string | object, status: number, origin: string | null, maxAge = 0) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}, stale-while-revalidate=600` : "no-store",
    },
  });
}
const clientIp = (req: Request) =>
  (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "0")
    .split(",")[0].trim();

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const uploadToken = async (reviewId: string) => (await sha256(`${SECRET_KEY}:photo:${reviewId}`)).slice(0, 32);

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max) : "";
const int = (v: string | null, def: number, min: number, max: number) => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

const ITEM_COLS =
  "id,author_name,rating,title,body,size_fit,verified,created_at,reply_text,reply_date,product_name,product_url";

async function withPhotos(rows: any[]) {
  if (!rows.length) return [];
  const { data, error } = await db.from("review_photos")
    .select("review_id,url,thumb_url").in("review_id", rows.map((r) => r.id))
    .order("created_at", { ascending: true });
  if (error) throw error;
  const map: Record<string, { u: string; t: string | null }[]> = {};
  for (const p of data ?? []) (map[p.review_id] ??= []).push({ u: p.url, t: p.thumb_url });
  return rows.map((r) => ({ ...r, photos: map[r.id] ?? [] }));
}

async function listReviews(opts: { uid?: string; offset: number; limit: number; rating?: number; fit?: string }) {
  let q = db.from("reviews").select(ITEM_COLS).eq("approved", true)
    .order("created_at", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit);
  if (opts.uid) q = q.eq("product_uid", opts.uid);
  if (opts.rating) q = q.eq("rating", opts.rating);
  if (opts.fit) q = q.eq("size_fit", opts.fit);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const more = rows.length > opts.limit;
  return { items: await withPhotos(rows.slice(0, opts.limit)), more };
}

async function stats(uid: string | null) {
  const { data, error } = await db.rpc("api_stats", { p_uid: uid });
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const ip = clientIp(req);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply({ error: "forbidden" }, 403, null);

  try {
    if (req.method === "GET") {
      if (!softLimit(ip)) return reply({ error: "rate_limited" }, 429, origin);

      if (a === "ratings") {
        const body = await cached("ratings", 300, async () => {
          const { data, error } = await db.rpc("api_catalog_ratings");
          if (error) throw error;
          const r: Record<string, [number, number]> = {};
          for (const x of data ?? []) r[x.uid] = [Number(x.avg), Number(x.cnt)];
          return { r };
        });
        return reply(body, 200, origin, 600);
      }

      if (a === "product") {
        const uid = url.searchParams.get("uid") ?? "";
        if (!/^\d{6,20}$/.test(uid)) return reply({ error: "bad_uid" }, 400, origin);
        const offset = int(url.searchParams.get("offset"), 0, 0, 10000);
        const limit = int(url.searchParams.get("limit"), 5, 1, PAGE_MAX);
        const rating = int(url.searchParams.get("rating"), 0, 0, 5);
        const fitRaw = url.searchParams.get("fit") ?? "";
        const fit = ["small", "true", "large"].includes(fitRaw) ? fitRaw : "";
        const key = `p:${uid}:${offset}:${limit}:${rating}:${fit}`;
        const body = await cached(key, 180, async () => {
          const list = await listReviews({ uid, offset, limit, rating: rating || undefined, fit: fit || undefined });
          return offset === 0 ? { stats: await stats(uid), ...list } : list;
        });
        return reply(body, 200, origin, 300);
      }

      if (a === "latest") {
        const offset = int(url.searchParams.get("offset"), 0, 0, 10000);
        const limit = int(url.searchParams.get("limit"), 6, 1, PAGE_MAX);
        const body = await cached(`l:${offset}:${limit}`, 180, async () => {
          const list = await listReviews({ offset, limit });
          return offset === 0 ? { stats: await stats(null), ...list } : list;
        });
        return reply(body, 200, origin, 300);
      }

      return reply({ error: "unknown_action" }, 400, origin);
    }

    if (req.method === "POST") {
      if (!origin) return reply({ error: "forbidden" }, 403, null);
      const ipHash = await sha256(`${SECRET_KEY}:ip:${ip}`);

      if (a === "submit") {
        const b = await req.json().catch(() => ({}));
        if (b.hp || (typeof b.t === "number" && b.t < 3000)) return reply({ ok: true, id: null }, 200, origin);

        const okHour = await db.rpc("api_hit", { p_key: `sub:h:${ipHash}`, p_limit: 3, p_window_seconds: 3600 });
        const okDay = await db.rpc("api_hit", { p_key: `sub:d:${ipHash}`, p_limit: 8, p_window_seconds: 86400 });
        if (okHour.data === false || okDay.data === false) return reply({ error: "rate_limited" }, 429, origin);

        const product_id = clean(b.product_id, 300);
        const author_name = clean(b.author_name, 60);
        const body = clean(b.body, 1400);
        const title = clean(b.title, 100) || null;
        const rating = Number(b.rating);
        const size_fit = ["small", "true", "large"].includes(b.size_fit) ? b.size_fit : null;
        if (!/tproduct[-/]\d{6,}/.test(product_id)) return reply({ error: "bad_product" }, 400, origin);
        if (!author_name || !body || !(rating >= 1 && rating <= 5) || !Number.isInteger(rating)) {
          return reply({ error: "validation" }, 400, origin);
        }
        let product_url: string | null = clean(b.product_url, 500) || null;
        if (product_url && !ALLOWED_ORIGINS.some((o) => product_url!.startsWith(o + "/"))) product_url = null;

        const { data, error } = await db.from("reviews").insert({
          product_id, product_name: clean(b.product_name, 200) || null, product_url,
          author_name, rating, title, body, size_fit, approved: false, verified: false, ip_hash: ipHash,
        }).select("id").single();
        if (error) throw error;
        // телефон — окремо, лише для адміністратора (на сайт не потрапляє)
        const digits = clean(b.phone, 20).replace(/\D/g, "");
        if (digits.length >= 10 && digits.length <= 13) {
          const phone = "+" + (digits.length === 10 && digits.startsWith("0") ? "38" + digits : digits);
          await db.from("review_contacts").insert({ review_id: data.id, phone });
        }
        return reply({ ok: true, id: data.id, k: await uploadToken(data.id) }, 200, origin);
      }

      if (a === "vote") {
        // «Відгук корисний?»: один голос з пристрою (IP + браузер); v = 1, -1 або 0 (зняти)
        const b = await req.json().catch(() => ({}));
        const id = typeof b.id === "string" ? b.id : "";
        const v = Number(b.v);
        if (!/^[0-9a-f-]{36}$/.test(id) || ![1, -1, 0].includes(v)) return reply({ error: "validation" }, 400, origin);
        const ok = await db.rpc("api_hit", { p_key: `vote:${ipHash}`, p_limit: 60, p_window_seconds: 3600 });
        if (ok.data === false) return reply({ error: "rate_limited" }, 429, origin);
        const voter = await sha256(`${SECRET_KEY}:voter:${ip}:${req.headers.get("user-agent") ?? ""}`);
        const { data, error } = await db.rpc("review_vote", { p_review: id, p_voter: voter, p_vote: v });
        if (error) throw error;
        if (!data) return reply({ error: "not_found" }, 404, origin);
        return reply({ ok: true, ...data }, 200, origin);
      }

      if (a === "photo") {
        const id = url.searchParams.get("id") ?? "";
        const k = url.searchParams.get("k") ?? "";
        if (!/^[0-9a-f-]{36}$/.test(id) || k !== await uploadToken(id)) return reply({ error: "forbidden" }, 403, origin);

        const { data: rev } = await db.from("reviews").select("id,product_uid,approved,created_at").eq("id", id).single();
        if (!rev || rev.approved || Date.now() - new Date(rev.created_at).getTime() > 2 * 3600_000) {
          return reply({ error: "expired" }, 403, origin);
        }
        const { count } = await db.from("review_photos").select("id", { count: "exact", head: true }).eq("review_id", id);
        if ((count ?? 0) >= MAX_PHOTOS) return reply({ error: "too_many" }, 400, origin);

        // три копії, стиснені в браузері: full (до 1600 px), mid (1080 px, для перегляду), thumb (240×320).
        // Імена: <фото>.<ext>, <фото>.<ext>.m.webp, <фото>.<ext>.t.webp — віджет знаходить копії за адресою фото.
        const fd = await req.formData();
        const full = fd.get("full");
        const mid = fd.get("mid");
        const thumb = fd.get("thumb");
        const okType = (f: unknown): f is File =>
          f instanceof File && ["image/webp", "image/jpeg", "image/png"].includes(f.type);
        if (!okType(full) || full.size > 3_000_000) return reply({ error: "bad_file" }, 400, origin);
        if (mid && (!okType(mid) || mid.size > 1_500_000)) return reply({ error: "bad_file" }, 400, origin);
        if (thumb && (!okType(thumb) || thumb.size > 400_000)) return reply({ error: "bad_file" }, 400, origin);

        const ext = full.type === "image/webp" ? "webp" : full.type === "image/png" ? "png" : "jpg";
        const main = `${rev.product_uid}/${id}/${Date.now()}.${ext}`;
        const opts = { contentType: full.type, cacheControl: "31536000", upsert: false };
        const pub = (p: string) => db.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
        const up = await db.storage.from(BUCKET).upload(main, full, opts);
        if (up.error) throw up.error;
        let thumbUrl: string | null = null, midUrl: string | null = null;
        if (okType(thumb)) {
          const ut = await db.storage.from(BUCKET).upload(`${main}.t.webp`, thumb, { ...opts, contentType: thumb.type });
          if (!ut.error) thumbUrl = pub(`${main}.t.webp`);
        }
        if (okType(mid)) {
          const um = await db.storage.from(BUCKET).upload(`${main}.m.webp`, mid, { ...opts, contentType: mid.type });
          if (!um.error) midUrl = pub(`${main}.m.webp`);
        }
        // orig_url тут — копія для перегляду: адмінка видаляє url, thumb_url і orig_url разом
        const ins = await db.from("review_photos").insert({ review_id: id, url: pub(main), thumb_url: thumbUrl, orig_url: midUrl });
        if (ins.error) throw ins.error;
        return reply({ ok: true }, 200, origin);
      }

      return reply({ error: "unknown_action" }, 400, origin);
    }

    return reply({ error: "method" }, 405, origin);
  } catch (e) {
    console.error(a, e);
    return reply({ error: "server" }, 500, origin);
  }
});
