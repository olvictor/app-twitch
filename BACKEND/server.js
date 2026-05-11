require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
// 1️⃣ Importando o FFmpeg
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);

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

app.get("/clips", async (req, res) => {
  try {
    const { channel } = req.query;

    if (!channel) {
      return res.status(400).json({
        error: "Faltando parâmetro: channel",
      });
    }

    const token = await getAccessToken();

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

    // 2️⃣ Calcular datas (Últimos 30 dias até agora)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30); // Subtrai 30 dias da data de hoje
    
    const start = thirtyDaysAgo.toISOString(); // Data de 30 dias atrás
    const end = new Date().toISOString();      // Data de agora

    // 3️⃣ Buscar clips no range
    // Dica: coloquei first=50 para ele buscar um pool maior antes de cortar os 15 mais recentes
    const clipsRes = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&started_at=${start}&ended_at=${end}&first=50`,
      {
        headers: {
          "Client-ID": process.env.CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const clipsData = await clipsRes.json();

    if (!clipsData.data) {
      // Retorna no formato esperado pelo frontend
      return res.json({ data: [] });
    }

    // 4️⃣ Ordenar por mais recentes (opcional: a Twitch já ordena por visualizações por padrão)
    const sorted = clipsData.data.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    // 5️⃣ Retornar os 15 mais recentes envelopados no objeto "data"
    const latest = sorted.slice(0, 15);

    res.json({ data: latest });
  } catch (err) {
    console.error("Erro no /clips:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});


app.get("/download-clip", async (req, res) => {
  try {
    const { clipId, vertical } = req.query; 
    const token = await getAccessToken();

    const clipRes = await fetch(`https://api.twitch.tv/helix/clips?id=${clipId}`, {
      headers: {
        "Client-ID": process.env.CLIENT_ID,
        "Authorization": `Bearer ${token}`
      }
    });
    const clipData = await clipRes.json();

    if (!clipData.data || clipData.data.length === 0) {
      return res.status(404).send("Clip não encontrado");
    }

    // Pega a URL do MP4
    const videoUrl = clipData.data[0].thumbnail_url.split("-preview-")[0] + ".mp4";
    const isVertical = vertical === 'true';

    if (isVertical) {
      // DOWNLOAD VERTICAL (TIKTOK/REELS) - Via FFmpeg
      res.setHeader("Content-Disposition", `attachment; filename=${clipId}_vertical.mp4`);
      res.setHeader("Content-Type", "video/mp4");

      ffmpeg(videoUrl)
        .videoFilters("crop=ih*(9/16):ih") // Corta no formato 9:16
        .outputOptions([
          "-c:a copy", // Copia o áudio sem processar (mais rápido)
          "-movflags frag_keyframe+empty_moov" // 🔥 ESSENCIAL: Permite que o MP4 seja enviado via stream
        ])
        .format("mp4")
        .on("error", (err) => {
          console.error("Erro no FFmpeg:", err);
          if (!res.headersSent) res.status(500).send("Erro ao processar vídeo vertical.");
        })
        .pipe(res, { end: true }); // Envia o vídeo aos poucos para o usuário

    } else {
      // DOWNLOAD ORIGINAL - Voltando para o método de Buffer que funcionava para você
      const videoRes = await fetch(videoUrl);
      
      if (!videoRes.ok) {
         return res.status(500).send("Erro ao buscar o vídeo original na Twitch");
      }

      const videoBuffer = await videoRes.buffer();
      
      res.setHeader("Content-Disposition", `attachment; filename=${clipId}.mp4`);
      res.setHeader("Content-Type", "video/mp4");
      res.send(videoBuffer);
    }

  } catch (err) {
    console.error("Erro na rota de download:", err);
    if (!res.headersSent) {
      res.status(500).send("Erro ao baixar o clipe");
    }
  }
});

app.listen(PORT, () => console.log("Backend rodando."));
