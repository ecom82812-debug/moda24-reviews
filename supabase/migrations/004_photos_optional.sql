-- Фото у відгуку — за бажанням: відгук без фото теж можна опублікувати.
drop trigger if exists reviews_require_photo on public.reviews;
drop function if exists public.reviews_require_photo();
