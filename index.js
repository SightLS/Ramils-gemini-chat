require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const systemPrompt = require('./prompt.js');

const app = express();
const PORT = process.env.PORT || 3228;

const API_KEY = process.env.API_KEY;
const MODEL = process.env.MODEL || 'gemini-2.5-flash-lite';

if (!API_KEY) {
  console.error('Ошибка: API_KEY не найден в файле .env');
  process.exit(1);
}

// Кэш частых вопросов
const commonAnswers = {
  "кто такой рамиль?": "Рамиль Нуруллаев - фулл-стек разработчик со специализацией в веб-технологиях и разработке ПО",
  "чем занимается рамиль?": "Рамиль занимается веб-разработкой, созданием адаптивных интерфейсов и системным администрированием.",
  "какие навыки у рамиля?": "Основные навыки: Vue.js, Node.js, Docker, настройка серверов и веб-разработка."
};

// Хранилище состояния диалогов: { dialogId: { isFirstMessage: boolean, lastUpdated: timestamp } }
const dialogStates = {};

// Middleware
app.use(cors({
  origin: 'https://sightls-profile.vercel.app',
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type'],
}));

app.use(bodyParser.json());

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/chat', limiter);

app.post('/api/chat', async (req, res) => {
  const userMessage = (req.body.message || '').trim();
  const dialogId = req.body.dialogId || 'default'; // если нет — общий диалог

  if (!userMessage) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }
  if (userMessage.length > 500) {
    return res.status(400).json({ error: 'Сообщение слишком длинное (максимум 500 символов)' });
  }

  // Инициализация состояния диалога, если нового или устаревшего (>30 минут)
  const now = Date.now();
  if (
    !dialogStates[dialogId] ||
    (now - dialogStates[dialogId].lastUpdated) > 30 * 60 * 1000
  ) {
    dialogStates[dialogId] = {
      isFirstMessage: true,
      lastUpdated: now,
    };
  }

  // Обновляем таймстамп
  dialogStates[dialogId].lastUpdated = now;

  // Проверка кэша частых вопросов
  const normalizedQuestion = userMessage.toLowerCase();
  if (commonAnswers[normalizedQuestion]) {
    return res.json({ reply: commonAnswers[normalizedQuestion] });
  }

  try {
    let fullPrompt = systemPrompt;

    if (dialogStates[dialogId].isFirstMessage) {
      fullPrompt += "\n\nЭто первое сообщение в диалоге. Представься кратко.";
      dialogStates[dialogId].isFirstMessage = false;
    } else {
      fullPrompt += "\n\nЭто продолжение диалога. Не представляйся снова.";
    }

    fullPrompt += `\n\nВопрос: ${userMessage}\nОтвет:`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: fullPrompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 1,
          topP: 1,
          maxOutputTokens: 150
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Ошибка от Google API:', errorData);
      return res.status(response.status).json({
        error: `Ошибка от внешнего API: ${errorData.error?.message || 'Неизвестная ошибка'}`
      });
    }

    const data = await response.json();

    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      let botReply = data.candidates[0].content.parts[0].text;

      // Удаляем повторные приветствия если они есть (не обязательно, но можно)
      if (!dialogStates[dialogId].isFirstMessage) {
        botReply = botReply.replace(/Привет, я Мини Рамилька, цифровой помощник Рамиля/g, '');
      }

      res.json({ reply: botReply.trim() || "Не могу ответить на этот вопрос" });
    } else {
      res.status(500).json({ error: 'Не удалось обработать ответ от модели' });
    }
  } catch (error) {
    console.error('Ошибка API:', error);
    res.status(500).json({ error: 'Произошла ошибка при обращении к API' });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'API работает',
    available_endpoints: {
      chat: 'POST /api/chat'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
