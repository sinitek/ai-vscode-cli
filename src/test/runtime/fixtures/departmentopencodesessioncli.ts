import * as fs from "fs";
import * as http from "http";
import * as path from "path";
const directory = process.env.DEPARTMENT_FIXTURE_DIRECTORY!;
const file = (name: string) => path.join(directory, name);
const wait = (name: string, done: () => void) => {
  if (fs.existsSync(file(name))) { done(); return; }
  const timer = setInterval(() => { if (fs.existsSync(file(name))) { clearInterval(timer); done(); } }, 5);
};
if (process.argv[2] !== "serve") require("./departmentprocessproductioncli");
else {
  fs.appendFileSync(file("server-count"), "serve\n");
  fs.writeFileSync(file("native-cwd"), fs.realpathSync(process.cwd()));
  const server = http.createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost"), pathname = url.pathname;
    if (url.searchParams.get("directory") !== fs.realpathSync(process.cwd())) { response.writeHead(400); response.end(); return; }
    if (request.headers.authorization !== `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`) {
      response.writeHead(401); response.end(); return;
    }
    if (request.method === "POST" && pathname === "/session") {
      let body = ""; request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        if (body !== "{}") { response.writeHead(400); response.end(); return; }
        fs.appendFileSync(file("create-count"), "create\n");
        fs.writeFileSync(file("create-ready"), "ready");
        const respond = () => response.end(JSON.stringify({ id: "ses_fixture", directory: process.env.DEPARTMENT_FIXTURE_BAD_DIRECTORY ? directory : fs.realpathSync(process.cwd()) }));
        if (process.env.DEPARTMENT_FIXTURE_CREATE_GATE) wait("create-open", respond); else respond();
      });
    } else if (request.method === "GET" && pathname === "/session/ses_fixture") {
      fs.appendFileSync(file("verify-count"), "verify\n");
      response.end(JSON.stringify({ id: "ses_fixture", directory: process.env.DEPARTMENT_FIXTURE_BAD_DIRECTORY ? directory : fs.realpathSync(process.cwd()) }));
    } else {
      fs.appendFileSync(file("unexpected-request"), `${request.method} ${pathname}\n`);
      response.writeHead(400); response.end();
    }
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address() as { port: number };
    process.stdout.write(`opencode server listening on http://127.0.0.1:${address.port}\n`);
  });
  process.once("SIGTERM", () => {
    fs.writeFileSync(file("server-close-ready"), "ready");
    const close = () => { fs.writeFileSync(file("server-closed"), "closed"); process.stdout.write("native-server-tail\n"); process.exit(0); };
    if (process.env.DEPARTMENT_FIXTURE_SERVER_CLOSE_GATE) wait("server-close-open", close); else close();
  });
}
