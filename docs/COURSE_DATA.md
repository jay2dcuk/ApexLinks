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
    "lengths": [
      350, 350, 350, 350, 350, 350, 350, 350, 350, 350, 350, 350, 350, 350, 350,
      350, 350, 350
    ],
    "pars": [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
    "indexes": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
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

## Open-data download (version 0.9.2)

A club administrator can use **Courses → Worldwide directory → Download open course directory**. This starts a background download of named golf-course locations mapped in OpenStreetMap, with visible Downloading/Importing/Completed/Failed status. It populates the shared venue directory, which is searched locally before the live provider. Existing scoring tee sets and historical scores are preserved. A successful job reports the actual stored count; it does not claim complete real-world coverage.

The web loader starts with Britain/Ireland, then covers the world in 30-degree regions (73 requests, including the overlapping first region). Each region has a 35-second request deadline, a 32 MB response limit and a fallback to a second public Overpass provider. Successful regions are validated and committed immediately; duplicate OpenStreetMap IDs are updated rather than duplicated. Empty ocean regions are recorded as complete. A one-second pause separates regions. The UI displays unique stored locations and saved-region progress.

Failed or interrupted jobs can be resumed after one minute using **Resume open course download**. The next attempt starts with the failed region, preserving completed regions across app restarts; an old all-world timeout can be retried immediately after upgrading. Successful complete downloads have a 24-hour cooldown. Larger/slow regions can still fail on public infrastructure: resumption preserves progress but cannot guarantee provider availability. The development network proxy blocks public Overpass access with HTTP 403 (including a small regional probe), so a real download has not been verified here or on Render. This proxy restriction does not establish whether Render can reach the providers. The app reports network failures instead of populating fictional courses. Automated tests cover the download workflow with mocked data only.

For an operator with shell access, run against the same persistent `DATABASE_PATH` as the app:

```sh
npm run import:open-courses
```

That attempts a public global Overpass download. Alternatively, supply a genuine Overpass JSON export file (up to 128 MB):

```sh
npm run import:open-courses -- /path/to/overpass-golf-courses.json
```

The file must contain an `elements` array with named node/way/relation features tagged `leisure=golf_course`. Re-imports update the same OpenStreetMap feature IDs without duplicating them. The importer was exercised with a temporary fixture database, including a repeated import; no real worldwide dataset was seeded during development. Respect the public provider’s usage policy and use regional exports when a global request is unavailable or too large.

Local name search ignores letter case and accents. Country filters retain venues with unknown country because many OpenStreetMap course records lack an explicit country tag. Review the selected location before entering tee data. Imported locations retain OpenStreetMap attribution and contain null rating/slope values. Pars, stroke indexes and official tee-rating values must still be supplied from an appropriate source; a course location alone is not a playable scorecard.

## Directory search and maps

The worldwide directory automatically searches after a 1.7-second typing pause (three characters minimum). Enter or Search directory runs a search immediately. Downloaded locations and cached searches are used before contacting Overpass. New input cancels the old browser request; stale responses cannot replace newer results. Provider requests have a nine-second deadline; the browser stops waiting after twelve seconds and offers a retry. Public Overpass availability and coverage are not guaranteed. A country code helps narrow the search.

The first result displays an interactive OpenStreetMap embed; View map switches to another result. Entries without coordinates show an explicit message. Open full map offers an external alternative if an embedded map is blocked. This requires access to www.openstreetmap.org and its map infrastructure; the server CSP explicitly permits only that external frame host. Maps are never cached for offline use by the service worker. Browser checks mock the external map and directory, so they do not establish live provider availability. No API key is required. Maps and course suggestions do not supply official ratings.

## Bulk files instead of Overpass (version 0.9.3)

The optional operator tool uses Geofabrik's regional OpenStreetMap `.osm.pbf` files. It does not query Overpass or scrape a third-party course directory. The source catalogue is `https://download.geofabrik.de/index-v1.json`. Selection uses leaf extracts rather than downloading both parents and their children. `world` processes every usable leaf extract advertised by that catalogue; this does not guarantee every real-world course, complete planet coverage, or complete official tee data.

Run on an operator machine with Python 3, Node 24, network access to `download.geofabrik.de`, and substantial temporary disk space. It downloads one region at a time, requires processing headroom, and removes temporary files afterward. Large worldwide imports are a background operator job, not a browser request. The web **Download open course directory** button still uses the separate resumable Overpass loader.

```sh
python3 -m venv /tmp/apex-course-tools
/tmp/apex-course-tools/bin/python -m pip install -r scripts/course-tools-requirements.txt
COURSE_PYTHON=/tmp/apex-course-tools/bin/python npm run test:bulk-courses
COURSE_PYTHON=/tmp/apex-course-tools/bin/python npm run import:geofabrik -- world
```

Set `DATABASE_PATH` to the intended SQLite database; it defaults to `data/apexlinks.sqlite`. Importing into a local database does not update Render's database. On a production worker, use the correct persistent database and coordinate access; do not replace a live SQLite database file. Python tooling is optional and is not a new web-app runtime requirement. The command does not install Python or pyosmium on Render automatically.

A specific catalogue region ID can replace `world`. Completed region IDs are checkpointed in the database. Rerun the same command to resume; use `world --refresh` for a deliberate full refresh of already saved regions. Run one bulk worker per database at a time. PBF files are verified against the source's MD5 checksums over HTTPS before parsing. Missing/invalid checksums, insufficient disk, corrupt downloads or parse errors stop the import and retain previous regions. Geometry is reduced to named `leisure=golf_course` features and their references before calculating approximate bounding-box centres. Distinct OSM IDs may still describe the same real-world venue; ID upserts prevent duplicate records for the same OSM feature, not every semantic duplicate.

The app retains OpenStreetMap attribution and ODbL source links. If distributing the resulting database or a derived extract, comply with the applicable [ODbL](https://opendatacommons.org/licenses/odbl/) obligations. No rating, slope, par or stroke-index values are invented from geographic data.

FreeGolfTracker was suggested as an alternative, but this environment could not retrieve its pages to verify a bulk export or reuse licence. Its publicly visible directory has not been treated as permission to copy its database. No FreeGolfTracker data has been copied.

The cloud network configuration additions for FreeGolfTracker, Geofabrik and OSM were saved for review. They have not been confirmed applied. Real source downloads remain blocked by the network proxy; tests use fictional PBF fixtures and mocked HTTP. Tests exercise node/way/nested-relation locations, checksum rejection, checkpoint resumption, deduplication and SQLite persistence. They do not establish a populated worldwide production directory.
