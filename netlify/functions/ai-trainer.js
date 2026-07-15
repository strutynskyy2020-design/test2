const { scenarios, knowledge } = require("./ai-trainer-data");
const json=(statusCode,body)=>({statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},body:JSON.stringify(body)});
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
function extractText(data){if(typeof data.output_text==="string")return data.output_text;for(const item of data.output||[])for(const content of item.content||[])if(typeof content.text==="string")return content.text;return ""}
function parseModelJson(text){return JSON.parse(text.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim())}

const normalize=(value="")=>String(value).toLowerCase().replace(/ё/g,"е").replace(/ґ/g,"г").replace(/[^a-zа-яіїє0-9!?.'’\s-]/gi," ").replace(/\s+/g," ").trim();
const severePatterns=[
  /(хуй|хуйн|пизд|пізд|їб|єб|ебан|йоб|блят|бляд|сучар|мудак|мраз|гандон)/i,
  /((іди|йди|пішов|пішла).{0,12}(на|в).{0,4}х)/i,
  /(заткнись|закрий\s+рот|тупа|тупий|дебіл|ідіот|лох|дурепа)/i,
  /(я\s+тебе\s+(знайду|звільню|покараю|приб.?ю)|пошкодуєш|будуть\s+проблеми)/i,
];
const pressurePatterns=[
  /(ви\s+зобов.?язані|ви\s+мусите|негайно\s+оформлюємо|без\s+варіантів|не\s+вигадуйте|не\s+сперечайтеся)/i,
  /(тільки\s+сьогодні|останній\s+шанс)/i,
];
const deceptionPatterns=[
  /(точно\s+нічого\s+не\s+заплатите|гарантовано\s+без\s+переплат|комісій\s+немає\s+взагалі|відсотків\s+немає\s+ніколи)/i,
];
function localSafetyCheck(text){
  const t=normalize(text);
  if(!t || t.length<2)return {severity:"low",type:"Порожня відповідь",feedback:"Відповідь надто коротка, щоб підтримати розмову."};
  if(severePatterns.some(r=>r.test(t)))return {severity:"terminal",type:"Образа або нецензурна лексика",feedback:"Нецензурна лексика чи образа в банківській розмові одразу завершує контакт і створює ризик скарги."};
  if(deceptionPatterns.some(r=>r.test(t)))return {severity:"high",type:"Неправдива гарантія",feedback:"Не можна давати абсолютні гарантії щодо переплат або комісій. Потрібно прозоро пояснювати умови."};
  if(pressurePatterns.some(r=>r.test(t)))return {severity:"high",type:"Тиск на клієнта",feedback:"Тиск забирає в клієнта відчуття контролю та різко знижує довіру."};
  const caps=(String(text).match(/[А-ЯA-ZІЇЄ]/g)||[]).length; const letters=(String(text).match(/[А-ЯA-Zа-яa-zІЇЄіїє]/g)||[]).length;
  if(letters>12 && caps/letters>.75)return {severity:"medium",type:"Агресивний тон",feedback:"Повідомлення виглядає як крик. Знизьте тон і поверніться до спокійного діалогу."};
  return null;
}

exports.handler=async(event)=>{
 if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
 if(!process.env.OPENAI_API_KEY)return json(500,{error:"У Netlify не налаштовано OPENAI_API_KEY"});
 let body;try{body=JSON.parse(event.body||"{}")}catch{return json(400,{error:"Некоректний запит"})}
 const {action,scenarioId,history=[],operatorText="",patience=0,conversion=0}=body;const s=scenarios[scenarioId];
 if(!s||!["start","turn"].includes(action))return json(400,{error:"Невідомий сценарій"});
 const [product,difficulty,person,persona,opening]=s;const facts=knowledge[product]||"Для цього універсального сценарію оцінюй техніку продажу без вигадування характеристик продукту.";
 const dialogue=Array.isArray(history)?history.slice(-14).map(m=>`${m.role==="operator"?"Оператор":"Клієнт"}: ${String(m.text||"").slice(0,900)}`).join("\n"):"";
 const instructions=`Ти рушій реалістичного тренажера продажів українською. Грай клієнта послідовно. Оцінюй продаж і комунікацію, не граматику. Терпіння та довіра мають змінюватися насамперед через зміст і тон слів оператора, а не через кількість повідомлень. Для банківських продуктів суворо спирайся на базу фактів, не вигадуй тарифи й не заохочуй приховування ризиків. Не погоджуйся надто швидко, але легкий клієнт має реально просуватися до рішення після 3-5 сильних відповідей. Відповідай лише валідним JSON без markdown.`;
 const base=`Продукт: ${product}. Складність: ${difficulty}. Клієнт: ${person}. Характер: ${persona}. Початкове заперечення: ${opening}.\nБаза знань: ${facts}`;
 if(action==="turn"){
   const safety=localSafetyCheck(operatorText);
   if(safety?.severity==="terminal")return json(200,{score:0,techniques:["Порушення стандартів комунікації"],feedback:safety.feedback,strong_response:"У цьому випадку коректна дія — вибачитися, припинити тиск і професійно завершити розмову.",why_better:["Не погіршує конфлікт","Знижує ризик скарги","Зберігає професійний стандарт"],patience_delta:-100,trust_delta:-100,client_mood:"обурений",client_reply:"Я припиняю цю розмову і залишу скаргу на таке спілкування.",terminal:true,outcome:"complaint",violation:safety.type});
   if(safety?.severity==="high")return json(200,{score:1,techniques:[safety.type],feedback:safety.feedback,strong_response:"Розумію ваші сумніви. Я не хочу тиснути, тому коротко поясню умови й залишу рішення за вами. Що саме викликає найбільше запитань?",why_better:["Повертає клієнту контроль","Визнає сумнів без суперечки","Переходить до уточнення потреби"],patience_delta:-40,trust_delta:-30,client_mood:"роздратований",client_reply:"Мені не подобається такий підхід. Якщо ви будете тиснути або обіцяти неможливе, я завершу розмову.",terminal:false,violation:safety.type});
   if(safety?.severity==="medium")return json(200,{score:2,techniques:[safety.type],feedback:safety.feedback,strong_response:"Перепрошую, моя фраза прозвучала різко. Дозвольте пояснити спокійніше й відповісти саме на ваше запитання.",why_better:["Визнає проблему тону","Знижує напругу","Повертає розмову до потреби клієнта"],patience_delta:-25,trust_delta:-15,client_mood:"роздратований",client_reply:"Будь ласка, не говоріть зі мною таким тоном. Поясніть спокійно або завершимо розмову.",terminal:false,violation:safety.type});
 }
 const prompt=action==="start"?`${base}\nПочни короткою природною реплікою клієнта, використовуючи його заперечення, але не копіюй механічно. JSON: {"client_reply":"...","client_mood":"нейтральний|скептичний|роздратований"}`:`${base}\nТерпіння ${clamp(patience,0,100)}/100, готовність ${clamp(conversion,0,100)}/100. Відповідь оператора: ${String(operatorText).slice(0,1200)}\nДіалог:\n${dialogue}\nОціни 0-10. Поверни 1-3 реально застосовані техніки лише з переліку: Активне слухання, Емпатія, Уточнення потреби, SPIN, Аргументація цінністю, Робота із запереченням, Прозорість умов, Закриття угоди. Фідбек максимум двома короткими практичними реченнями. Також дай один природний приклад сильної відповіді оператора, який краще відповідає саме на останню репліку клієнта, та 2-4 короткі причини, чому він сильніший. Не називай його єдино правильною відповіддю. Штрафуй неправдиві банківські твердження, грубість, ігнорування питання та нав'язливість. patience_delta від -35 до +15, trust_delta від -25 до +25. Орієнтир: 9-10 балів дає +10..+15 терпіння і +18..+25 довіри; 7-8 дає +4..+9 терпіння і +12..+18 довіри; 5-6 дає -3..+3 терпіння і +3..+10 довіри; 3-4 дає -10..-4 терпіння і -8..+2 довіри; 0-2 дає -35..-15 терпіння і -25..-10 довіри. Якщо оператор коректно підсумував потребу, прозоро пояснив умови та запропонував доречний наступний крок, можеш повернути deal_ready=true. JSON: {"score":0,"techniques":["..."],"feedback":"...","strong_response":"...","why_better":["...","..."],"patience_delta":0,"trust_delta":0,"client_mood":"скептичний|роздратований|пом'якшується|зацікавлений|переконаний","client_reply":"...","deal_ready":false}`;
 try{const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4.1-mini",instructions,input:prompt,max_output_tokens:600,temperature:.55})});const data=await response.json();if(!response.ok){console.error("OpenAI",response.status,data);return json(response.status,{error:response.status===429?"Закінчився баланс API або перевищено ліміт":"OpenAI не зміг відповісти"})}const result=parseModelJson(extractText(data));if(action==="turn"){result.score=clamp(result.score,0,10);result.patience_delta=clamp(result.patience_delta,-35,15);result.trust_delta=clamp(result.trust_delta,-25,25);result.terminal=Boolean(result.terminal);result.deal_ready=Boolean(result.deal_ready);if(!Array.isArray(result.techniques))result.techniques=[result.technique||"Робота із запереченням"]}return json(200,result)}catch(error){console.error(error);return json(500,{error:"Не вдалося обробити відповідь AI. Спробуйте ще раз."})}
};
