require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 4000;
let accessToken = null;
let tokenExpires = 0;

async function getAccessToken() {
  if (!accessToken || Date.now() >= tokenExpires) {
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    });

    const data = await res.json();
    accessToken = data.access_token;
    tokenExpires = Date.now() + data.expires_in * 1000;
  }
  return accessToken;
}

app.get("/clips-range", async (req, res) => {
  try {
    const { channel, date } = req.query;

    if (!channel || !startDate) {
      return res.status(400).json({
        error: "Faltando parâmetros: channel e startDate",
      });
    }

    const token = await getAccessToken();

    // 1️⃣ Buscar user_id
    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${channel}`,
      {
        headers: {
          "Client-ID": process.env.CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const userData = await userRes.json();
    const userId = userData.data?.[0]?.id;

    if (!userId) {
      return res.status(404).json({ error: "Canal não encontrado" });
    }

    // 2️⃣ Datas
    const start = `${date}T00:00:00Z`;
    const end = new Date().toISOString(); // 🔥 sempre agora

    // 3️⃣ Buscar clips no range
    const clipsRes = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&started_at=${start}&ended_at=${end}&first=15`,
      {
        headers: {
          "Client-ID": process.env.CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const clipsData = await clipsRes.json();

    if (!clipsData.data) {
      return res.json([]);
    }

    // 4️⃣ Ordenar por mais recentes
    const sorted = clipsData.data.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    // 5️⃣ Retornar os 10 mais recentes
    const latest = sorted.slice(0, 15);

    res.json(latest);
  } catch (err) {
    console.error("Erro no /clips-range:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});



app.get("/download-clip", async (req, res) => {
  try {
    const { clipId } = req.query;
    const token = await getAccessToken();


    const clipRes = await fetch(`https://api.twitch.tv/helix/clips?id=${clipId}`, {
      headers: {
        "Client-ID": process.env.client_id,
        "Authorization": `Bearer ${token}`
      }
    });
    const clipData = await clipRes.json();

    if (!clipData.data || clipData.data.length === 0) {
      return res.status(404).send("Clip não encontrado");
    }

    const videoUrl = clipData.data[0].thumbnail_url.split("-preview-")[0] + ".mp4";

    const videoRes = await fetch(videoUrl);
    const videoBuffer = await videoRes.buffer();

    res.setHeader("Content-Disposition", `attachment; filename=${clipId}.mp4`);
    res.setHeader("Content-Type", "video/mp4");
    res.send(videoBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao baixar o clipe");
  }
});


app.listen(PORT, () => console.log("Backend rodando."));
