// server.js
require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Импортируем промпт из отдельного файла
const systemPrompt = require('./prompt.js');

const app = express();
const PORT = process.env.PORT || 3228;

// Используем переменные окружения для API ключа и модели
const API_KEY = process.env.API_KEY;
const MODEL = process.env.MODEL || 'gemini-2.5-flash-lite';

if (!API_KEY) {
  console.error('Ошибка: API_KEY не найден в файле .env');
  process.exit(1);
}

// Глобальная переменная для отслеживания первого сообщения
let isFirstMessage = true;

// Сбрасываем флаг первого сообщения каждые 30 минут
setInterval(() => {
  isFirstMessage = true;
}, 30 * 60 * 1000);

// Кэш для частых вопросов
const commonAnswers = {
  "кто такой рамиль?": "Рамиль Нуруллаев - фулл-стек разработчик со специализацией в веб-технологиях и разработке ПО",
  "чем занимается рамиль?": "Рамиль занимается веб-разработкой, созданием адаптивных интерфейсов и системным администрированием.",
  "какие навыки у рамиля?": "Основные навыки: Vue.js, Node.js, Docker, настройка серверов и веб-разработка."
};

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Ограничение запросов
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов с одного IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/chat', limiter);

app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message?.trim();

  if (!userMessage) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }

  // Проверяем кэш частых вопросов
  const normalizedQuestion = userMessage.toLowerCase();
  if (commonAnswers[normalizedQuestion]) {
    return res.json({ reply: commonAnswers[normalizedQuestion] });
  }

  try {
    let fullPrompt = systemPrompt;
    
    if (isFirstMessage) {
      fullPrompt += "\n\nЭто первое сообщение в диалоге. Представься кратко.";
      isFirstMessage = false;
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
      
      // Удаляем повторные приветствия если они есть
      if (!isFirstMessage) {
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