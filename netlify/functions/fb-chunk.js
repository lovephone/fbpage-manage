// netlify/functions/fb-chunk.js
// รับ raw binary chunk ส่งต่อ graph-video.facebook.com
// token/session ส่งผ่าน query string เพื่อหลีก Netlify header size limit

const https = require("https");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const q = event.queryStringParameters || {};
  const sessionId   = q.session_id;
  const startOffset = q.start_offset || "0";
  const pageId      = q.page_id;
  const token       = q.token;

  if (!sessionId || !pageId || !token) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing query params: session_id, page_id, token" }) };
  }

  try {
    const chunkBuf = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "binary");

    if (chunkBuf.length === 0) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Empty chunk body" }) };
    }

    const boundary = "----FBChunk" + Date.now();
    const pre = [
      `--${boundary}\r\nContent-Disposition: form-data; name="upload_phase"\r\n\r\ntransfer`,
      `--${boundary}\r\nContent-Disposition: form-data; name="start_offset"\r\n\r\n${startOffset}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="upload_session_id"\r\n\r\n${sessionId}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${token}`,
    ].join("\r\n") + "\r\n";

    const videoHeader = `--${boundary}\r\nContent-Disposition: form-data; name="video_file_chunk"; filename="chunk.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
    const epilogue    = `\r\n--${boundary}--\r\n`;
    const preBuf      = Buffer.from(pre + videoHeader, "utf8");
    const epiBuf      = Buffer.from(epilogue, "utf8");
    const body        = Buffer.concat([preBuf, chunkBuf, epiBuf]);

    const result = await new Promise((resolve, reject) => {
      const opts = {
        hostname: "graph-video.facebook.com",
        path:     `/v19.0/${pageId}/videos`,
        method:   "POST",
        headers: {
          "Content-Type":   `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      };
      const req = https.request(opts, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try { resolve(JSON.parse(d)); }
          catch { resolve({ raw: d }); }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    return { statusCode: 200, headers: CORS, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
