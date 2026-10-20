"""Extract named golf locations from a local OSM/PBF file; never infer tee ratings."""
import json
import sys
import tempfile
from pathlib import Path

try:
    import osmium
except ImportError:
    sys.exit("Install the bulk-import tools: python3 -m pip install -r scripts/course-tools-requirements.txt")


def course(obj):
    return obj.tags.get("leisure") == "golf_course" and bool(obj.tags.get("name", "").strip())


class SelectCourses(osmium.SimpleHandler):
    def __init__(self, writer):
        super().__init__()
        self.writer = writer

    def node(self, obj):
        if course(obj):
            self.writer.add_node(obj)

    def way(self, obj):
        if course(obj):
            self.writer.add_way(obj)

    def relation(self, obj):
        if course(obj):
            self.writer.add_relation(obj)


class Locations(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.boxes = {}
        self.relations = {}
        self.courses = []

    def remember(self, obj, kind):
        if course(obj):
            self.courses.append({"type": kind, "id": obj.id, "tags": dict(obj.tags)})

    def node(self, obj):
        if obj.location.valid():
            self.boxes[("n", obj.id)] = (obj.location.lat, obj.location.lon, obj.location.lat, obj.location.lon)
        self.remember(obj, "node")

    def way(self, obj):
        points = [(n.lat, n.lon) for n in obj.nodes if n.location.valid()]
        if points:
            self.boxes[("w", obj.id)] = (min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points))
        self.remember(obj, "way")

    def relation(self, obj):
        self.relations[obj.id] = [(m.type, m.ref) for m in obj.members]
        self.remember(obj, "relation")

    def box(self, key, seen=None):
        if key in self.boxes:
            return self.boxes[key]
        seen = set() if seen is None else seen
        if key[0] != "r" or key in seen or len(seen) >= 16:
            return None
        seen = seen | {key}
        boxes = [b for member in self.relations.get(key[1], []) if (b := self.box(member, seen))]
        if not boxes:
            return None
        return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def extract(source, output):
    # Reference completion keeps only course geometry in memory, not every node in a country.
    with tempfile.TemporaryDirectory(prefix="apex-osm-", dir=Path(output).parent) as work:
        reduced = str(Path(work) / "courses.osm.pbf")
        with osmium.BackReferenceWriter(reduced, ref_src=source, relation_depth=16) as writer:
            SelectCourses(writer).apply_file(source)
        locations = Locations()
        locations.apply_file(reduced, locations=True)
        for obj in locations.courses:
            box = locations.box((obj["type"][0], obj["id"]))
            if box:
                longitude = (box[1] + box[3]) / 2
                if box[3] - box[1] > 180:
                    longitude = (longitude + 180 + 180) % 360 - 180
                obj["center"] = {"lat": (box[0] + box[2]) / 2, "lon": longitude}
        with open(output, "w", encoding="utf-8") as stream:
            json.dump({"elements": locations.courses}, stream, ensure_ascii=False)
        print(f"Extracted {len(locations.courses)} mapped golf locations; tee ratings are not included.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python extract-osm-courses.py source.osm.pbf output.json")
    extract(sys.argv[1], sys.argv[2])
