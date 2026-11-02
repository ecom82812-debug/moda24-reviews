# Відгуки moda24.online

Відгуки покупців з фото: форма на сторінці товару, модерація в адмінці, показ на сайті.
Схема така сама, як на madona.com.ua (`madona-reviews-widget`).

## Як це працює

1. Покупець заповнює форму на сторінці товару. Фото обов'язкові, стискаються в браузері.
2. Відгук і фото йдуть у функцію `reviews-api`. Напряму в базу чи сховище відвідувач нічого записати не може.
3. Власник схвалює відгук в адмінці. Відгук без фото база не дасть опублікувати.
4. Раз на хвилину (лише якщо щось змінилось) функція `reviews-snapshot` збирає готові JSON-файли у сховищі `review-cache`.
   Сайт читає ці файли, а не базу, тому відгуки не навантажують сторінку.

## Supabase

Проєкт `lvyssuomgbccjmksetof` (`https://lvyssuomgbccjmksetof.supabase.co`).

| Що | Де |
|---|---|
| Таблиці, захист (RLS), функції бази, сховище, розклад | `supabase/migrations/001_reviews.sql` |
| API для сайту | `supabase/functions/reviews-api` (`verify_jwt: false`, власна перевірка) |
| Збирання JSON-файлів | `supabase/functions/reviews-snapshot` (`verify_jwt: false`, ключ `snap_key` у Vault) |

Готові файли для сайту (`review-cache`, публічні):

- `v1/ratings.json` — оцінки всіх товарів `{ r: { uid: [avg, count, ver] } }`
- `v1/p/<uid>.json` — схвалені відгуки одного товару
- `v1/home.json` — загальні цифри й останні відгуки

Ключ `snap_key` не зберігається в репозиторії. Після розгортання з нуля його створюють у SQL:

```sql
select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'snap_key');
```

Адміністратор — запис у `public.admin_users` з `user_id` користувача Supabase Auth.
