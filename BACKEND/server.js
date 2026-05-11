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
    // Multiplica por 1000 para converter para milissegundos
    tokenExpires = Date.now() + (data.expires_in * 1000); 
  }
  return accessToken;
}

// ROTA DE BUSCA DOS ÚLTIMOS 30 DIAS
app.get("/clips", async (req, res) => {
  try {
    const { channel } = req.query;

    if (!channel) {
      return res.status(400).json({
        error: "Faltando parâmetro: channel",
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

    // 2️⃣ Calcular datas: Últimos 30 dias até o momento atual
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const start = thirtyDaysAgo.toISOString();
    const end = new Date().toISOString(); 

    // 3️⃣ Buscar clips no range
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
      return res.json({ data: [] });
    }

    // 4️⃣ Ordenar do mais recente para o mais antigo
    const sorted = clipsData.data.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    // 5️⃣ Retornar os 15 mais recentes
    const latest = sorted.slice(0, 15);

    res.json({ data: latest });
  } catch (err) {
    console.error("Erro no /clips:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// ROTA DE DOWNLOAD ORIGINAL (Segura e usando Buffer)
app.get("/download-clip", async (req, res) => {
  try {
    const { clipId } = req.query;
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

    // Transformando a URL da thumbnail na URL de download do MP4
    const videoUrl = clipData.data[0].thumbnail_url.split("-preview-")[0] + ".mp4";

    const videoRes = await fetch(videoUrl);
    
    if (!videoRes.ok) {
       return res.status(500).send("Falha ao baixar o arquivo da Twitch.");
    }
    
    // Usando .buffer() igual ao seu código original (funciona melhor na Render)
    const videoBuffer = await videoRes.buffer();

    res.setHeader("Content-Disposition", `attachment; filename=${clipId}.mp4`);
    res.setHeader("Content-Type", "video/mp4");
    res.send(videoBuffer);

  } catch (err) {
    console.error("Erro ao fazer download:", err);
    if (!res.headersSent) {
      res.status(500).send("Erro ao baixar o clipe");
    }
  }
});

app.listen(PORT, () => console.log(`Backend rodando na porta ${PORT}.`));