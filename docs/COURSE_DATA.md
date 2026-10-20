# Worldwide course data

ApexLinks stores scoring tee sets in each organisation’s persistent SQLite state. A tee record includes its own pars, stroke indexes, course rating, slope and rating category. Those values must come from the applicable rating authority or a supplier authorised to redistribute them.

## What the directory does

Courses → Worldwide directory queries OpenStreetMap through the public Overpass API at `https://overpass-api.de/api/interpreter`. Search a course name (at least three characters), optionally with a two-letter uppercase country code such as GB, US or AU. Up to 50 results are returned, cached for 24 hours. Searches are rate limited; no results are treated as proof that a course does not exist. The venue directory is incomplete and does not supply authoritative slope/course ratings.

Results retain their OpenStreetMap URL and `© OpenStreetMap contributors (ODbL)` attribution. See https://www.openstreetmap.org/copyright. Selecting a venue opens an unsaved tee form with empty pars, indexes and ratings. Saving requires actual hole data. Names and locations are not enough to create a correct scoring course.

The development network returned HTTP 403 when attempting a real directory query. The adapter and UI were validated with mocked responses. Live access on Render has not been verified. If unavailable, manual entry and authorised CSV/JSON import still work. No source account, licence or proprietary API credential has been invented.

## Loading official worldwide tee ratings

A complete worldwide database requires an authorised dataset or API agreement, rather than assuming one federation covers every jurisdiction. Obtain supplier documentation covering:

- Countries/courses/tee categories and nine/eighteen-hole coverage.
- Rating authority, source IDs, effective dates, updates and withdrawn/re-rated tees.
- Permission to cache, display, redistribute/export and retain historical ratings.
- Hole-by-hole pars, stroke indexes, lengths and applicable rating category.
- API authentication, quotas, import format, reconciliation rules and costs.

Secure credentials belong in Render Environment, never in chat, exports or Git. The current importer accepts the schema below; a supplier-specific API adapter requires that supplier’s actual documentation and authorisation. Current course data is labelled organiser-provided and never gains an official verification badge merely because it was imported.

## JSON import

Use Courses → Import tee sets, choose a `.json` file, or paste an array. Import at most 100 rows and 95 KB per batch. **The following is fictional schema example data, not an official rating.** Replace all course, hole and rating data with your authorised source.

```json
[
  {
    "name": "Example course — replace with supplied name",
    "tee": "White",
    "location": "Town",
    "country": "GB",
    "ratedFor": "Men",
    "rating": 72.1,
    "slope": 128,
    "ratingSource": "Replace with rating authority/source reference",
    "sourceURL": "https://example.com/replace-with-rating-source",
    "ratingAsOf": "2026-10-01",
    "lengthUnit": "yards",
    "lengths": [350,350,350,350,350,350,350,350,350,350,350,350,350,350,350,350,350,350],
    "pars": [4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4],
    "indexes": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]
  }
]
```

Use one row per tee/rating category. Categories are `Men`, `Women` and `Unspecified`. Ratings must be 50–90, slope 55–155, and each of the eighteen stroke indexes must appear exactly once. Pars are 3–6. Hole lengths are optional (null if unknown), 30–1,000 yards/metres. Source URLs must use HTTP/HTTPS and cannot contain credentials. An invalid or duplicate row causes the entire batch to be rejected. Existing records must be edited deliberately; imports never silently overwrite an existing tee.

## CSV import

Download the CSV template inside the import dialog. Required columns:

- `name`, `tee`
- `par1` through `par18`
- `si1` through `si18`

Optional columns: `location`, `country`, `ratedFor`, `rating`, `slope`, `ratingSource`, `sourceURL`, `ratingAsOf`, `lengthUnit`, and `length1` through `length18`. Column names are case-insensitive, ignoring spaces, hyphens and underscores. Unknown/duplicate columns are rejected. Quoted commas, quotes, multiline fields, CRLF and UTF-8 BOMs are supported. Numbers use a decimal point. Blank ratings remain unknown, rather than becoming zero. Omit unused optional columns or leave their cells blank.

## Scoring and history

New rounds capture the tee’s pars/indexes and rating/provenance snapshot. Individual tee assignments capture their own settings and must belong to the same named course, location and country. Use consistent venue details across tee records. Later edits do not change recorded rounds. Templates retain the snapshot they captured; review effective dates before applying one to a new event.

Attested exports use the player’s captured tee, rather than mutable current course ratings. Legacy rounds without a snapshot report null ratings and cannot safely be assumed eligible for handicap posting. The calculator is a preview based on supplied values; official score acceptance and regional competition rules still require the relevant governing body’s approved workflow.

Nine-hole/short-course ratings, automatic federation verification and full worldwide supplier synchronisation remain outstanding. No complete worldwide dataset is currently populated.
