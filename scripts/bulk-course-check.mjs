import { execFileSync } from "node:child_process";
execFileSync(
  process.env.COURSE_PYTHON || "python3",
  [
    "-m",
    "unittest",
    "discover",
    "-s",
    "test",
    "-p",
    "bulk_courses_test.py",
    "-v",
  ],
  { stdio: "inherit" },
);
