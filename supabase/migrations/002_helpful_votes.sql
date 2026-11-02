-- «Відгук корисний?» — голоси покупців.
-- Один голос з одного пристрою на відгук (voter — хеш IP + браузера, рахує функція reviews-api).
-- Лічильники лежать прямо у reviews, щоб потрапляти в готові файли без зайвих запитів.

alter table public.reviews
  add column if not exists helpful_up int not null default 0,
  add column if not exists helpful_down int not null default 0;

create table public.review_votes (
  review_id uuid not null references public.reviews(id) on delete cascade,
  voter text not null,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (review_id, voter)
);
alter table public.review_votes enable row level security;
-- політик немає: таблицю читає і пише лише reviews-api (секретний ключ)

-- голос: новий, змінений або знятий (p_vote = 0); повертає нові лічильники
create or replace function public.review_vote(p_review uuid, p_voter text, p_vote smallint)
returns json language plpgsql security definer set search_path to '' as $$
declare v_old smallint;
begin
  if not exists (select 1 from public.reviews where id = p_review and approved) then
    return null;
  end if;
  select vote into v_old from public.review_votes where review_id = p_review and voter = p_voter;
  if p_vote = 0 then
    delete from public.review_votes where review_id = p_review and voter = p_voter;
  else
    insert into public.review_votes (review_id, voter, vote) values (p_review, p_voter, p_vote)
    on conflict (review_id, voter) do update set vote = excluded.vote, created_at = now();
  end if;
  update public.reviews set
    helpful_up   = (select count(*) from public.review_votes where review_id = p_review and vote = 1),
    helpful_down = (select count(*) from public.review_votes where review_id = p_review and vote = -1)
  where id = p_review;
  return (select json_build_object('up', helpful_up, 'down', helpful_down) from public.reviews where id = p_review);
end $$;
revoke execute on function public.review_vote(uuid, text, smallint) from public, anon, authenticated;
