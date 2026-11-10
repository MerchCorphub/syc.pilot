# Scan Your Color: pilot

Web app for the Scan Your Color (SYC) pilot. It opens from a link, works on phones and computers, and can be saved to a home screen.
Patent pending, U.S. App. No. 19/836,387. © Merch Corporation.

## What is here

| Path | What it is |
| --- | --- |
| `index.html`, `js/app.js` | Shopper app: welcome, optional registration, store pick, camera scan, result, survey, saved scans |
| `admin.html`, `js/admin.js` | Admin pages (sign-in required): pilot data, scan log export and delete, survey builder, store list |
| `js/reader.js` | Color reader from the SYC working model (four stages) |
| `js/config.js` | Supabase project address, stage names, scan settings |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lets shoppers save the app to a home screen |
| `supabase/functions/purge-old-photos/` | Scheduled job that deletes scan photos older than 120 days |

## Data

All data is stored in the Supabase project `syc-pilot`: scan attempts, scans, scan photos (private bucket `scan-photos`),
phones, registered shoppers, stores, survey questions and survey answers. The table setup lives in that project's migration history.

- Shoppers are never signed in. They can add scans, photos and answers but cannot read anyone's data.
- Only approved admin emails, signed in and confirmed, can read, export or delete.
- Photos are deleted automatically every 30 days once older than 120 days. Records stay until an admin deletes them.

## Running it

It is a static site with no build step. Serve the folder over HTTPS (the camera needs HTTPS); GitHub Pages works.
