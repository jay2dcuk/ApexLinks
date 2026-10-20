"""Optional end-to-end PBF extraction and SQLite import checks, using fictional data."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import osmium

FIXTURE = '''<osm version="0.6" generator="ApexLinks-test">
<node id="1" lat="51.0" lon="-0.5"><tag k="leisure" v="golf_course"/><tag k="name" v="Fictional Point Course"/></node>
<node id="2" lat="51.1" lon="-0.4"/><node id="3" lat="51.2" lon="-0.4"/>
<node id="4" lat="51.2" lon="-0.2"/><node id="5" lat="51.1" lon="-0.2"/>
<way id="10"><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="2"/><tag k="leisure" v="golf_course"/><tag k="name" v="Fictional Way Course"/></way>
<way id="11"><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="2"/></way>
<way id="12"><nd ref="2"/><nd ref="3"/><tag k="leisure" v="park"/><tag k="name" v="Not A Course"/></way>
<relation id="20"><member type="way" ref="11" role="outer"/><tag k="type" v="multipolygon"/></relation>
<relation id="21"><member type="relation" ref="20" role="outer"/><tag k="leisure" v="golf_course"/><tag k="name" v="Fictional Nested Course"/></relation>
</osm>'''


class BulkCoursesTest(unittest.TestCase):
    def test_real_pbf_reader_keeps_references_and_deduplicates_imports(self):
        with tempfile.TemporaryDirectory(prefix="apex-bulk-test-") as folder:
            work = Path(folder)
            source = work / "fixture.osm"
            source.write_text(FIXTURE)
            pbf = work / "fixture.osm.pbf"
            with osmium.SimpleWriter(str(pbf)) as writer:
                for obj in osmium.FileProcessor(str(source)):
                    writer.add(obj)
            output = work / "courses.json"
            subprocess.run([sys.executable, "scripts/extract-osm-courses.py", str(pbf), str(output)], check=True)
            records = json.loads(output.read_text())["elements"]
            self.assertEqual(len(records), 3)
            self.assertEqual({v["type"] for v in records}, {"node", "way", "relation"})
            self.assertAlmostEqual(records[2]["center"]["lat"], 51.15)
            self.assertAlmostEqual(records[2]["center"]["lon"], -0.3)
            database = work / "courses.sqlite"
            env = {**os.environ, "DATABASE_PATH": str(database)}
            for _ in range(2):
                result = subprocess.run(["node", "scripts/import-open-courses.mjs", str(output)], env=env, check=True, text=True, capture_output=True)
                self.assertIn("directory contains 3", result.stdout)
            # Exercise the actual bulk CLI with mocked HTTP, real PBF and real SQLite.
            hook = work / "mock-bulk-source.mjs"
            hook.write_text("""
import {readFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const pbf=readFileSync(process.env.BULK_TEST_PBF);
globalThis.fetch=async url=>{
 appendFileSync(process.env.BULK_TEST_LOG,url+'\\n');
 if(url.endsWith('index-v1.json')) return Response.json({features:[{properties:{id:'fixture',name:'Fixture',urls:{pbf:'https://download.geofabrik.de/fixture-latest.osm.pbf'}}}]});
 if(url.endsWith('.md5')) return new Response((process.env.BULK_TEST_BAD ? '0'.repeat(32) : createHash('md5').update(pbf).digest('hex'))+'  fixture.osm.pbf');
 return new Response(pbf,{headers:{'content-length':String(pbf.length)}});
};
""")
            bulkdb = work / "bulk.sqlite"
            request_log = work / "requests.txt"
            bulk_env = {**env, "DATABASE_PATH": str(bulkdb), "COURSE_PYTHON": sys.executable,
                        "COURSE_DOWNLOAD_PATH": str(work / "cache"), "BULK_TEST_PBF": str(pbf), "BULK_TEST_LOG": str(request_log)}
            command = ["node", "--import", str(hook), "scripts/import-geofabrik.mjs", "world"]
            first = subprocess.run(command, env=bulk_env, check=True, capture_output=True, text=True)
            self.assertIn("3 unique mapped locations", first.stdout)
            second = subprocess.run(command, env=bulk_env, check=True, capture_output=True, text=True)
            self.assertIn("Already saved: Fixture", second.stdout)
            self.assertEqual(len(request_log.read_text().splitlines()), 4)
            self.assertEqual(list((work / "cache").iterdir()), [])
            bad_env = {**bulk_env, "DATABASE_PATH": str(work / "bad.sqlite"), "BULK_TEST_BAD": "true"}
            bad = subprocess.run(command, env=bad_env, capture_output=True, text=True)
            self.assertNotEqual(bad.returncode, 0)
            self.assertIn("checksum mismatch", bad.stderr)
            import sqlite3
            with sqlite3.connect(work / "bad.sqlite") as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM course_venues").fetchone()[0], 0)
            with sqlite3.connect(bulkdb) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM course_venues").fetchone()[0], 3)
            with sqlite3.connect(database) as db:
                rows = db.execute("SELECT payload FROM course_venues").fetchall()
                self.assertEqual(len(rows), 3)
                for row in rows:
                    venue = json.loads(row[0])
                    self.assertIsNone(venue["slope"])
                    self.assertIsNone(venue["rating"])
                    self.assertIn("OpenStreetMap", venue["directoryAttribution"])

    def test_empty_export_is_valid(self):
        with tempfile.TemporaryDirectory(prefix="apex-empty-test-") as folder:
            source = Path(folder) / "empty.osm"
            source.write_text('<osm version="0.6"></osm>')
            output = Path(folder) / "courses.json"
            subprocess.run([sys.executable, "scripts/extract-osm-courses.py", str(source), str(output)], check=True)
            self.assertEqual(json.loads(output.read_text()), {"elements": []})
