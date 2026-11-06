# IV-X Field (Supabase version) — setup

Your Supabase project is already filled in (`config.js`). Steps:

## 4. Create the database (2 min)
1. In Supabase, open **SQL Editor** in the left sidebar, then click **+ New query**.
2. Open `supabase-setup.sql` from this folder, copy all of it, paste it in, and click **Run**.
3. It should say "Success. No rows returned."

## 5. Logins (2 min per person)
1. Go to **Authentication → Sign In / Providers** (or **Authentication → Settings**) and turn **OFF** "Allow new users to sign up". This means only people you add can get in.
2. Go to **Authentication → Users → Add user → Create new user**. Enter an email and password, tick **Auto Confirm User**, and click **Create user**. Do this for yourself and for each teammate.

## 6. Put the app online (5 min)
Drag this whole folder onto **https://app.netlify.com/drop**. You get a link like `https://something.netlify.app`.

## 7. On each phone
Open the link, sign in, and add it to the home screen (iPhone: Safari → Share → Add to Home Screen; Android: Chrome ⋮ → Install app).
Then set up **Settings → Products & prices**, **Pitch kit** and **QR shelf tags** once; they're shared with everyone.

Manager dashboard: `your-link/dashboard.html` (same login).
