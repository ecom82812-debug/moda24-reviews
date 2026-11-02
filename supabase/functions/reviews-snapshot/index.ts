// moda24.online — «знімок» відгуків.
// Збирає готові JSON-файли у публічному сховищі review-cache, щоб сайт НЕ звертався до бази на кожен перегляд:
//   v1/ratings.json        — рейтинги всіх товарів { r: { uid: [avg, count, ver] } }  (каталог + картка)
//   v1/home.json           — цифри + останні відгуки для головної
//   v1/p/<uid>.json        — усі схвалені відгуки одного товару
// Запускається з бази (pg_cron) лише коли щось змінилось, і раз на годину для страховки.
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
const SNAP_KEY = Deno.env.get("SNAP_KEY") ?? "";

const BUCKET = "review-cache";
const HOME_N = 120; // скільки останніх відгуків іде на головну
const COLS =
  "id,product_uid,product_name,product_url,author_name,rating,title,body,size_fit,verified,created_at,reply_text,reply_date";

const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

type Rev = Record<string, any> & { photos: string[] };

async function fetchAll(table: string, cols: string, approvedOnly: boolean) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(cols).order("created_at", { ascending: table !== "reviews" }).range(from, from + 999);
    if (approvedOnly) q = q.eq("approved", true);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function stats(list: Rev[]) {
  const dist = [0, 0, 0, 0, 0]; // 5,4,3,2,1
  const fit = { small: 0, true: 0, large: 0 } as Record<string, number>;
  let sum = 0, photos = 0;
  for (const r of list) {
    const k = Math.min(5, Math.max(1, Number(r.rating) || 0));
    dist[5 - k]++; sum += k;
    if (r.size_fit in fit) fit[r.size_fit]++;
    photos += r.photos.length;
  }
  const n = list.length;
  return { avg: n ? Math.round((sum / n) * 10) / 10 : 0, n, dist, fit, photos };
}

// компактний запис відгуку: порожні поля не пишемо
function slim(r: Rev, withProduct: boolean) {
  const o: Record<string, unknown> = {
    id: r.id, author_name: r.author_name, rating: r.rating, body: r.body, created_at: r.created_at,
  };
  if (r.title) o.title = r.title;
  if (r.size_fit) o.size_fit = r.size_fit;
  if (r.verified) o.verified = true;
  if (r.reply_text) { o.reply_text = r.reply_text; o.reply_date = r.reply_date; }
  if (r.photos.length) o.photos = r.photos;
  if (withProduct) { if (r.product_name) o.product_name = r.product_name; if (r.product_url) o.product_url = r.product_url; }
  return o;
}

async function hash(s: string) {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 5).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function put(path: string, body: string, maxAge: number) {
  const { error } = await db.storage.from(BUCKET).upload(path, new Blob([body], { type: "application/json" }), {
    upsert: true, contentType: "application/json; charset=utf-8", cacheControl: String(maxAge),
  });
  if (error) throw new Error(`${path}: ${error.message}`);
}

Deno.serve(async (req) => {
  const key = req.headers.get("x-snap-key") ?? "";
  const ok = SNAP_KEY ? key === SNAP_KEY : (await db.rpc("snapshot_check_key", { p_key: key })).data === true;
  if (!ok) return new Response("forbidden", { status: 403 });
  const t0 = Date.now();
  const opts = await req.json().catch(() => ({})) as { full?: boolean };

  // які товари змінились (з тригерів у базі); '*' або full — перебудувати всі
  const { data: claimed, error: ce } = await db.rpc("snapshot_claim");
  if (ce) return new Response(JSON.stringify({ error: ce.message }), { status: 500 });
  const dirty = new Set<string>((claimed as string[] | null) ?? []);
  const all = opts.full === true || dirty.has("*");

  try {
    const rows = await fetchAll("reviews", COLS, true);
    const pics = await fetchAll("review_photos", "review_id,url,created_at", false);
    const byId = new Map<string, Rev>();
    const reviews: Rev[] = rows.map((r) => { const x = { ...r, photos: [] as string[] }; byId.set(r.id, x); return x; });
    for (const p of pics) byId.get(p.review_id)?.photos.push(p.url);

    // по товарах
    const groups = new Map<string, Rev[]>();
    for (const r of reviews) {
      if (!r.product_uid) continue;
      (groups.get(r.product_uid) ?? groups.set(r.product_uid, []).get(r.product_uid)!).push(r);
    }
    const ratings: Record<string, [number, number, string]> = {};
    let written = 0;
    const jobs: [string, string][] = [];
    for (const [uid, list] of groups) {
      const body = JSON.stringify({ uid, stats: stats(list), items: list.map((r) => slim(r, false)) });
      const ver = await hash(body);
      const st = stats(list);
      ratings[uid] = [st.avg, st.n, ver];
      if (all || dirty.has(uid)) jobs.push([`v1/p/${uid}.json`, body]);
    }
    // файли товарів: по 4 одночасно, щоб не навантажувати сховище
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(jobs.slice(i, i + 4).map(([p, b]) => put(p, b, 86400)));
      written += Math.min(4, jobs.length - i);
    }

    const total = stats(reviews);
    await put("v1/ratings.json", JSON.stringify({ t: new Date().toISOString(), r: ratings }), 60);
    await put("v1/home.json", JSON.stringify({
      t: new Date().toISOString(), stats: total,
      items: reviews.slice(0, HOME_N).map((r) => slim(r, true)),
    }), 60);

    return new Response(JSON.stringify({ ok: true, reviews: reviews.length, products: groups.size, written, ms: Date.now() - t0 }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    // не вдалося — повертаємо позначки, щоб наступний запуск повторив
    if (dirty.size) await db.rpc("snapshot_mark_many", { p_uids: [...dirty] });
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
