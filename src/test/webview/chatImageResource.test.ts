import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { createChatImageResource, loadChatImageResource, MAX_CHAT_IMAGE_BYTES, resolveChatImagePath } from "../../webview/chatImageResource";

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64");

test("resolves POSIX, Windows, UNC, home, encoded and file URI image paths", () => {
  assert.equal(resolveChatImagePath("../图.png", "/work/project"), "/work/图.png");
  assert.equal(resolveChatImagePath("my%20folder/image.png", "/work"), "/work/my folder/image.png");
  assert.equal(resolveChatImagePath("~/图.png", "/work", "/home/user"), "/home/user/图.png");
  assert.equal(resolveChatImagePath("file:///tmp/%E5%9B%BE%20%E7%89%87.png", "/work"), "/tmp/图 片.png");
  assert.equal(resolveChatImagePath("C:/images/图.png", "/work"), "C:\\images\\图.png");
  assert.equal(resolveChatImagePath("file:///C:/images/a%20b.png", "/work"), "C:\\images\\a b.png");
  assert.equal(resolveChatImagePath("images/图.png", "C:\\work"), "C:\\work\\images\\图.png");
  assert.equal(resolveChatImagePath("\\\\server\\share\\图.png", "/work"), "\\\\server\\share\\图.png");
  assert.equal(resolveChatImagePath("file://server/share/a.png", "/work"), "\\\\server\\share\\a.png");
  assert.equal(resolveChatImagePath("%E0%A4%A", "/work"), path.resolve("/work", "%E0%A4%A"));
});

test("loads local images outside the workspace and converts actual bytes to portable data URLs", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "chat-image-test-"));
  try {
    const filename = path.join(directory, "图 片.png");
    await fs.promises.writeFile(filename, pixel);
    for (const source of [filename, pathToFileURL(filename).href, "图%20片.png"]) {
      const resource = await loadChatImageResource(source, directory);
      assert.deepEqual(resource.bytes, pixel);
      assert.equal(resource.source, "data:image/png;base64," + pixel.toString("base64"));
      assert.equal(resource.filename, "图 片.png");
    }
    const svg = '<svg viewBox="0 0 100 50"><text y="25">中文图示</text></svg>';
    await fs.promises.writeFile(path.join(directory, "流程.svg"), svg);
    const resource = await loadChatImageResource("流程.svg", directory);
    assert.equal(resource.mime, "image/svg+xml");
    assert.equal(resource.bytes.toString(), svg);
    assert.equal(resource.filename, "流程.svg");
    assert.match(resource.source, /^data:image\/svg\+xml,/);
    await fs.promises.writeFile(path.join(directory, "fake.png"), "not an image");
    await assert.rejects(loadChatImageResource("fake.png", directory), /不是支持的图片/);
    await assert.rejects(loadChatImageResource("missing.png", directory));
    await assert.rejects(loadChatImageResource("javascript:alert(1)", directory), /不支持/);
    await assert.rejects(loadChatImageResource("secret.txt", directory), /不支持/);
    await fs.promises.mkdir(path.join(directory, "folder.png"));
    await assert.rejects(loadChatImageResource("folder.png", directory), /不是普通图片/);
    const oversized = await fs.promises.open(path.join(directory, "large.png"), "w");
    await oversized.truncate(MAX_CHAT_IMAGE_BYTES + 1);
    await oversized.close();
    await assert.rejects(loadChatImageResource("large.png", directory), /20 MiB/);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("recognizes jpeg, gif, webp, bmp and avif signatures and rejects near misses", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(createChatImageResource(jpeg).mime, "image/jpeg");
  assert.equal(createChatImageResource(jpeg).filename.endsWith(".jpg"), true);
  assert.equal(createChatImageResource(Buffer.from("GIF89a", "ascii")).mime, "image/gif");
  assert.equal(createChatImageResource(Buffer.from("GIF87a", "ascii")).mime, "image/gif");
  const webp = Buffer.alloc(12);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  assert.equal(createChatImageResource(webp).mime, "image/webp");
  assert.equal(createChatImageResource(Buffer.from("BM", "ascii")).mime, "image/bmp");
  const avif = Buffer.alloc(32);
  avif.write("ftyp", 4, "ascii");
  avif.write("avif", 8, "ascii");
  assert.equal(createChatImageResource(avif).mime, "image/avif");
  const avis = Buffer.alloc(32);
  avis.write("ftyp", 4, "ascii");
  avis.write("avis", 8, "ascii");
  assert.equal(createChatImageResource(avis).mime, "image/avif");
  assert.throws(() => createChatImageResource(Buffer.from([0xff, 0xd8, 0x00])), /不是支持的图片/);
  assert.throws(() => createChatImageResource(Buffer.from("GIF87X", "ascii")), /不是支持的图片/);
  const wave = Buffer.alloc(12);
  wave.write("RIFF", 0, "ascii");
  wave.write("WAVE", 8, "ascii");
  assert.throws(() => createChatImageResource(wave), /不是支持的图片/);
  const ftyp = Buffer.alloc(32);
  ftyp.write("ftyp", 4, "ascii");
  ftyp.write("mp42", 8, "ascii");
  assert.throws(() => createChatImageResource(ftyp), /不是支持的图片/);
});

test("rejects an oversized data URL before decoding and sanitizes download names", async () => {
  const payloadLimit = Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4;
  await assert.rejects(
    loadChatImageResource("data:image/png;base64," + "A".repeat(payloadLimit + 1), "/work"),
    /20 MiB/,
  );
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const illegal = `bad<>:"|?*${String.fromCharCode(1)}${"名".repeat(80)}.jpeg`;
  const named = createChatImageResource(jpeg, `..\\${illegal}`);
  assert.equal(named.filename, `bad${"_".repeat(8)}${"名".repeat(80)}`.slice(0, 100) + ".jpg");
  assert.equal(createChatImageResource(pixel, `${"n".repeat(150)}.png`).filename, `${"n".repeat(100)}.png`);
  assert.equal(createChatImageResource(pixel, "///.png").filename, "图片.png");
});

test("validates data image bytes and preserves SVG as a downloadable vector", async () => {
  const raster = await loadChatImageResource("data:image/png;base64," + pixel.toString("base64"), "/work");
  assert.deepEqual(raster.bytes, pixel);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"/>';
  const vector = await loadChatImageResource("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"), "/work");
  assert.equal(vector.bytes.toString(), svg);
  assert.equal(vector.filename, "图片.svg");
  assert.throws(() => createChatImageResource(Buffer.from("<html>fake</html>")), /不是支持的图片/);
  assert.throws(() => createChatImageResource(Buffer.alloc(MAX_CHAT_IMAGE_BYTES + 1)), /20 MiB/);
  assert.throws(() => createChatImageResource(Buffer.alloc(0)), /图片为空/);
  assert.equal(createChatImageResource(pixel, "../x.svg").filename, "x.png");
});

test("downloads HTTP images with byte validation, status checks and bounded responses", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/large") {
      response.writeHead(200, { "content-length": MAX_CHAT_IMAGE_BYTES + 1 });
      response.end();
    } else if (request.url === "/chunked-large") {
      response.writeHead(200, { "transfer-encoding": "chunked" });
      response.write(Buffer.alloc(MAX_CHAT_IMAGE_BYTES));
      response.end(Buffer.from([0]));
    } else if (request.url === "/missing") {
      response.writeHead(404).end();
    } else if (request.url === "/fake.png") {
      response.end("<html>not an image</html>");
    } else {
      response.end(pixel);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = "http://127.0.0.1:" + address.port;
  try {
    const image = await loadChatImageResource(origin + "/%E5%9B%BE.png", "/work");
    assert.deepEqual(image.bytes, pixel);
    assert.equal(image.filename, "图.png");
    await assert.rejects(loadChatImageResource(origin + "/large", "/work"), /20 MiB/);
    await assert.rejects(loadChatImageResource(origin + "/chunked-large", "/work"), /20 MiB/);
    await assert.rejects(loadChatImageResource(origin + "/missing", "/work"), /404/);
    await assert.rejects(loadChatImageResource(origin + "/fake.png", "/work"), /不是支持的图片/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
