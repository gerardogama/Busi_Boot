import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const {
  PORT = 3000,
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,
  JIRA_BASE,
  JIRA_EMAIL,
  JIRA_TOKEN,
  JIRA_JQL = 'statusCategory = "In Progress" ORDER BY updated DESC'
} = process.env;

// Verificación del webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de mensajes
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const msgs = changes?.value?.messages;
    if (!msgs || !msgs[0]) return res.sendStatus(200);

    const msg = msgs[0];
    const from = msg.from; // número del usuario
    const text = (msg.text?.body || "").trim().toLowerCase();

    if (text.includes("como vamos")) {
      const reply = await buildJiraProgressMessage();
      await sendWhatsappText(from, reply);
    } else if (/^detalles\s+[a-z0-9-]+/i.test(text)) {
      const key = text.split(/\s+/)[1].toUpperCase();
      const detail = await getIssueDetails(key);
      await sendWhatsappText(from, detail);
    } else {
      await sendWhatsappText(from, 'Dime "como vamos?" para ver tareas en curso.');
    }
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

// Consulta a Jira
async function jiraSearch(jql) {
  const url = `${JIRA_BASE}/rest/api/3/search`;
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");
  const { data } = await axios.get(url, {
    params: { jql, maxResults: 50, fields: "summary,assignee,updated,status" },
    headers: { Authorization: `Basic ${auth}` }
  });
  return data.issues || [];
}

// Formato del mensaje
async function buildJiraProgressMessage() {
  const issues = await jiraSearch(JIRA_JQL);
  if (!issues.length) return "No hay tareas en curso. 🎉";

  const groups = {};
  for (const it of issues) {
    const name = it.fields.assignee?.displayName || "Sin asignar";
    (groups[name] ||= []).push(it);
  }

  let out = "📊 Estado “En curso”\n\n";
  for (const [assignee, list] of Object.entries(groups)) {
    out += `• ${assignee}\n`;
    for (const it of list.slice(0, 5)) {
      out += `  - ${it.key} · ${it.fields.summary}\n`;
    }
    if (list.length > 5) out += `  …(${list.length - 5} más)\n`;
    out += "\n";
  }
  out += 'Tip: escribe "detalles BB-123" para ver una tarea.';
  return out.trim();
}

// Detalle de issue
async function getIssueDetails(key) {
  const url = `${JIRA_BASE}/rest/api/3/issue/${key}`;
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");
  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` }
    });
    const f = data.fields;
    return [
      `🔎 ${key}`,
      `Resumen: ${f.summary}`,
      `Estado: ${f.status?.name}`,
      `Asignado: ${f.assignee?.displayName || "Sin asignar"}`,
      `Actualizado: ${new Date(f.updated).toLocaleString()}`
    ].join("\n");
  } catch {
    return `No encontré ${key}.`;
  }
}

// Enviar respuesta por WhatsApp
async function sendWhatsappText(to, body) {
  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`;
  await axios.post(
    url,
    { messaging_product: "whatsapp", to, text: { body } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));

