const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Pastikan kamu sudah mengatur OPENAI_API_KEY di Railway Environment Variable!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Endpoint utama proxy
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages
      })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// Jalankan server di Railway (PORT env) atau lokal (8080)
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));
