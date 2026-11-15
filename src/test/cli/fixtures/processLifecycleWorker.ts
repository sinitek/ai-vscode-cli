import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Fixed, isolated payload. There is no public command/argv execution protocol.
if (process.argv[2] === "parent") {
  const tail = spawn(process.execPath, [__filename, "tail"], { stdio: ["ignore", process.stdout, process.stderr] });
  tail.unref();
  process.exit(0);
} else if (process.argv[2] === "tail") {
  setTimeout(() => { process.stdout.write("late-stdout\n"); process.stderr.write("late-stderr\n"); }, 150);
} else if (process.argv[2] === "overlay" || process.argv[2] === "overlay-block") {
  const root = path.dirname(process.env.OPENCODE_CONFIG!);
  if (process.argv[2] === "overlay-block") fs.writeFileSync(path.join(root, "unowned.txt"), "fixture");
  process.stdout.write(JSON.stringify({ root }) + "\n");
} else {
  process.stdout.write("fixture-stdout\n");
  process.stderr.write("fixture-stderr\n");
  process.exitCode = process.argv[2] === "failure" ? 7 : 0;
}
