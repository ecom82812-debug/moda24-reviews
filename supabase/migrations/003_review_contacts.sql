-- Телефон покупця до відгуку: бачить лише адміністратор, на сайт і в готові файли не потрапляє.
-- Окрема таблиця, щоб номер ніколи не віддавався разом із публічними даними відгуку.
create table public.review_contacts (
  review_id uuid primary key references public.reviews(id) on delete cascade,
  phone text not null check (length(phone) between 10 and 20),
  created_at timestamptz not null default now()
);
alter table public.review_contacts enable row level security;
create policy admin_all_contacts on public.review_contacts for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
