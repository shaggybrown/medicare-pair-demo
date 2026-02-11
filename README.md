# The Medicare Pair Demo (Public Site + Admin CRM)

This project now includes:

- Public Medicare landing site for Joe and MaryBeth Jessome.
- Backend API for consultations, seminar bookings, events, attendees, postcard campaigns, QR scan tracking, and task workflows.
- Admin dashboard to manage bookings/events/attendees and run postcard A/B tests.
- Seeded fake data for testing.

## Run locally

```bash
cd "/Users/david/Documents/New project"
npm start
```

Then open:

- Public site: [http://localhost:8787/](http://localhost:8787/)
- Admin dashboard: [http://localhost:8787/admin.html](http://localhost:8787/admin.html)

## Place Joe & MaryBeth photo

Put the image file at:

- `/Users/david/Documents/New project/assets/joe-marybeth.png`

The public site references this path directly.

## Seeded fake data location

Data is stored in:

- `/Users/david/Documents/New project/backend/data/crm.json`

It includes fake:

- events
- consultations
- attendees
- postcard campaigns and variants
- scan logs
- tasks

## Postcard QR tracking flow

- Each postcard variant has a QR URL in Admin.
- QR URL format: `/track/{campaignCode}/{variant}`
- Scans are counted and redirected to the public site with attribution query params.
- Consultation/seminar submissions from attributed visits increment postcard conversion metrics.

## Main files

- Backend: `/Users/david/Documents/New project/backend/server.js`
- CRM store: `/Users/david/Documents/New project/backend/lib/store.js`
- Public site: `/Users/david/Documents/New project/index.html`
- Public JS: `/Users/david/Documents/New project/app.js`
- Public styles: `/Users/david/Documents/New project/styles.css`
- Admin UI: `/Users/david/Documents/New project/admin.html`
- Admin JS: `/Users/david/Documents/New project/admin.js`
- Admin styles: `/Users/david/Documents/New project/admin.css`
