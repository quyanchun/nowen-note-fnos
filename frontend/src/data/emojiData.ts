export interface EmojiCategory {
  id: string;
  icon: string;
  labelKey: string;
  fallbackLabel: string;
  keywords: string[];
  emojis: string[];
}

export interface EmojiSearchResult {
  emoji: string;
  categoryId: string;
}

export const EMOJI_RECENT_STORAGE_KEY = "nowen.emojiPicker.recent";
export const EMOJI_RECENT_LIMIT = 24;

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean)));
}

function list(value: string): string[] {
  return unique(value.trim().split(/\s+/u));
}

const smileysPeople = list(`
😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 🫠 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳
😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😮‍💨 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓
🤗 🤔 🫣 🤭 🫢 🫡 🤫 🫨 🤥 😶 😶‍🌫️ 😐 😑 😬 🫥 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 😵‍💫 🫩 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕
🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾
👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 🫷 🫸 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏
✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 💋 🩸
👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 🥷 👷 🫅 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🫃 🫄 🤱
👼 🎅 🤶 🧑‍🎄 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 🕴️ 👯 🧖 🧗 🤺 🏇 ⛷️ 🏂 🏌️ 🏄 🚣 🏊 ⛹️ 🏋️ 🚴 🚵 🤸 🤼 🤽 🤾 🤹 🧘 🛀 🛌
👭 👫 👬 💏 💑 👪 🗣️ 👤 👥 🫂 👣
`);

const animalsNature = list(`
🐵 🐒 🦍 🦧 🐶 🐕 🦮 🐕‍🦺 🐩 🐺 🦊 🦝 🐱 🐈 🐈‍⬛ 🦁 🐯 🐅 🐆 🐴 🫎 🫏 🐎 🦄 🦓 🦌 🦬 🐮 🐂 🐃 🐄 🐷 🐖 🐗 🐽 🐏 🐑 🐐 🐪 🐫 🦙 🦒 🐘 🦣 🦏 🦛 🐭 🐁 🐀 🐹 🐰 🐇 🐿️ 🦫 🦔 🦇 🐻 🐻‍❄️ 🐨 🐼 🦥 🦦 🦨 🦘 🦡
🐾 🦃 🐔 🐓 🐣 🐤 🐥 🐦 🐧 🕊️ 🦅 🦆 🦢 🦉 🦤 🪶 🦩 🦚 🦜 🪽 🐦‍⬛ 🪿 🐦‍🔥
🐸 🐊 🐢 🦎 🐍 🐲 🐉 🦕 🦖 🐳 🐋 🐬 🦭 🐟 🐠 🐡 🦈 🐙 🐚 🪸 🪼 🦀 🦞 🦐 🦑 🦪
🐌 🦋 🐛 🐜 🐝 🪲 🐞 🦗 🪳 🕷️ 🕸️ 🦂 🦟 🪰 🪱 🦠
💐 🌸 💮 🪷 🏵️ 🌹 🥀 🌺 🌻 🌼 🌷 🪻 🌱 🪴 🌲 🌳 🌴 🌵 🌾 🌿 ☘️ 🍀 🍁 🍂 🍃 🪹 🪺 🍄 🍄‍🟫
🌍 🌎 🌏 🌐 🗺️ 🗾 🧭 🏔️ ⛰️ 🌋 🗻 🏕️ 🏖️ 🏜️ 🏝️ 🏞️
☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 🌪️ 🌫️ 🌈 ☔ ⚡ ☄️ 🔥 💧 🌊
🌙 🌚 🌛 🌜 🌡️ 🌝 🌞 🪐 ⭐ 🌟 🌠 🌌
`);

const foodDrink = list(`
🍏 🍎 🍐 🍊 🍋 🍋‍🟩 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🫛 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🫚 🫘 🥜 🌰
🍄 🍞 🥐 🥖 🫓 🥨 🥯 🥞 🧇 🧀 🍖 🍗 🥩 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🫔 🥙 🧆 🥚 🍳 🥘 🍲 🫕 🥣 🥗 🍿 🧈 🧂 🥫
🍱 🍘 🍙 🍚 🍛 🍜 🍝 🍠 🍢 🍣 🍤 🍥 🥮 🍡 🥟 🥠 🥡 🦪 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🥧 🍫 🍬 🍭 🍮 🍯
🍼 🥛 ☕ 🫖 🍵 🍶 🍾 🍷 🍸 🍹 🍺 🍻 🥂 🥃 🫗 🥤 🧋 🧃 🧉 🧊
🥢 🍽️ 🍴 🥄 🔪 🫙 🏺
`);

const activities = list(`
🎃 🎄 🎆 🎇 🧨 ✨ 🎈 🎉 🎊 🎋 🎍 🎎 🎏 🎐 🎑 🧧 🎀 🎁 🎗️ 🎟️ 🎫
⚽ ⚾ 🥎 🏀 🏐 🏈 🏉 🎾 🥏 🎳 🏏 🏑 🏒 🥍 🏓 🏸 🥊 🥋 🥅 ⛳ ⛸️ 🎣 🤿 🎽 🎿 🛷 🥌 🎯 🪀 🪁 🔫 🎱 🔮 🪄 🎮 🕹️ 🎰 🎲 🧩 🧸 🪅 🪩 🪆 ♠️ ♥️ ♦️ ♣️ ♟️ 🃏 🀄 🎴
🎭 🖼️ 🎨 🧵 🪡 🧶 🪢 👓 🕶️ 🥽 🥼 🦺 👔 👕 👖 🧣 🧤 🧥 🧦 👗 👘 🥻 🩱 🩲 🩳 👙 👚 🪭 👛 👜 👝 🛍️ 🎒 🩴 👞 👟 🥾 🥿 👠 👡 🩰 👢 🪮 👑 👒 🎩 🎓 🧢 🪖 ⛑️ 📿 💄 💍 💎
🎼 🎵 🎶 🎙️ 🎚️ 🎛️ 🎤 🎧 📻 🎷 🪗 🎸 🎹 🎺 🎻 🪕 🥁 🪘 🪇 🪈
🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️
`);

const travelPlaces = list(`
🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍️ 🛺 🛞 🚨 🚔 🚍 🚘 🚖 🛣️ 🛤️ 🛢️ ⛽ 🛞 🚧 ⚓ 🛟 ⛵ 🛶 🚤 🛳️ ⛴️ 🛥️ 🚢
✈️ 🛩️ 🛫 🛬 🪂 💺 🚁 🚟 🚠 🚡 🛰️ 🚀 🛸
🚉 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚋 🚃
⌛ ⏳ ⌚ ⏰ ⏱️ ⏲️ 🕰️ 🕛 🕧 🕐 🕜 🕑 🕝 🕒 🕞 🕓 🕟 🕔 🕠 🕕 🕡 🕖 🕢 🕗 🕣 🕘 🕤 🕙 🕥 🕚 🕦
🌑 🌒 🌓 🌔 🌕 🌖 🌗 🌘 🌙 🌚 🌛 🌜 🌡️ ☀️ 🌝 🌞 🪐 ⭐ 🌟 🌠 🌌
🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🛤️ 🛣️ 🗼 🗽 🏰 🏯 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🛖
🌁 🌃 🏙️ 🌄 🌅 🌆 🌇 🌉 ♨️ 🎑 🏞️
`);

const objects = list(`
⌚ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 🕹️ 🗜️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 🛒
💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱 ⛓️ ⛓️‍💥 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🪦 ⚱️ 🏺 🔮 📿 🧿 🪬 💈 ⚗️ 🔭 🔬 🕳️ 🩻 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🪠 🧺 🧻 🚽 🚿 🛁 🛀 🧼 🪥 🪒 🧽 🪣 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🛌 🧸 🪆 🖼️ 🪞 🪟 🛍️ 🛒 🎁 🎈 🎏 🎀 🪄 🪅 🎊 🎉
✉️ 📩 📨 📧 💌 📥 📤 📦 🏷️ 🪧 📪 📫 📬 📭 📮 📯 📜 📃 📄 📑 🧾 📊 📈 📉 🗒️ 🗓️ 📆 📅 🗑️ 📇 🗃️ 🗳️ 🗄️ 📋 📁 📂 🗂️ 🗞️ 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓
❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 🩶 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟
`);

const symbols = list(`
☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿ 🅿️ 🛗 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 ⚧️ 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ⏏️ ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 🟰 ♾️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 🔜 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜ ◼️ ◻️ ◾ ◽ ▪️ ▫️ 🔶 🔷 🔸 🔹 🔺 🔻 💠 🔘 🔳 🔲
`);

const COUNTRY_CODES = `AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CP CR CU CV CW CX CY CZ DE DG DJ DK DM DO DZ EA EC EE EG EH ER ES ET EU FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU IC ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(/\s+/u);

function countryCodeToFlag(code: string): string {
  return Array.from(code.toUpperCase())
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join("");
}

const flags = ["🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️", ...COUNTRY_CODES.map(countryCodeToFlag)];

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: "smileys", icon: "😀", labelKey: "emojiPicker.smileys", fallbackLabel: "表情与人物", keywords: ["表情", "人物", "笑脸", "手势", "people", "face", "smile", "gesture"], emojis: smileysPeople },
  { id: "nature", icon: "🐻", labelKey: "emojiPicker.nature", fallbackLabel: "动物与自然", keywords: ["动物", "自然", "植物", "天气", "animal", "nature", "plant", "weather"], emojis: animalsNature },
  { id: "food", icon: "🍎", labelKey: "emojiPicker.food", fallbackLabel: "食物与饮品", keywords: ["食物", "饮料", "水果", "food", "drink", "fruit"], emojis: foodDrink },
  { id: "activities", icon: "⚽", labelKey: "emojiPicker.activities", fallbackLabel: "活动与娱乐", keywords: ["活动", "运动", "游戏", "音乐", "艺术", "activity", "sport", "game", "music", "art"], emojis: activities },
  { id: "travel", icon: "🚀", labelKey: "emojiPicker.travel", fallbackLabel: "旅行与地点", keywords: ["旅行", "交通", "地点", "建筑", "travel", "transport", "place", "building"], emojis: travelPlaces },
  { id: "objects", icon: "💡", labelKey: "emojiPicker.objects", fallbackLabel: "物品", keywords: ["物品", "工具", "办公", "科技", "文件", "object", "tool", "office", "tech", "file"], emojis: objects },
  { id: "symbols", icon: "💯", labelKey: "emojiPicker.symbols", fallbackLabel: "符号", keywords: ["符号", "箭头", "数字", "标志", "symbol", "arrow", "number", "sign"], emojis: symbols },
  { id: "flags", icon: "🏳️", labelKey: "emojiPicker.flags", fallbackLabel: "旗帜", keywords: ["旗帜", "国家", "地区", "flag", "country", "region"], emojis: flags },
];

export const ALL_EMOJIS = unique(EMOJI_CATEGORIES.flatMap((category) => category.emojis));

const SEARCH_ALIASES: Record<string, string[]> = {
  "📁": ["文件夹", "目录", "folder", "directory"],
  "📂": ["打开文件夹", "open folder"],
  "🗂️": ["分类", "索引", "index", "category"],
  "📒": ["笔记本", "notebook", "notes"],
  "📓": ["笔记", "日记", "note", "journal"],
  "📔": ["记事本", "notebook"],
  "📕": ["红书", "book"], "📗": ["绿书", "book"], "📘": ["蓝书", "book"], "📙": ["橙书", "book"],
  "📚": ["书籍", "知识库", "books", "library", "knowledge"],
  "📖": ["阅读", "书", "read", "book"],
  "📝": ["写作", "编辑", "便签", "write", "edit", "memo"],
  "💼": ["工作", "商务", "work", "business"],
  "🏠": ["首页", "家庭", "home"],
  "⭐": ["星星", "收藏", "star", "favorite"],
  "❤️": ["爱心", "喜欢", "heart", "love"],
  "🔥": ["热门", "火", "hot", "fire"],
  "✨": ["闪光", "灵感", "sparkle", "magic"],
  "💡": ["灵感", "想法", "灯泡", "idea", "light"],
  "🎯": ["目标", "命中", "target", "goal"],
  "🚀": ["火箭", "启动", "项目", "rocket", "launch", "project"],
  "✅": ["完成", "正确", "check", "done", "success"],
  "❌": ["错误", "失败", "close", "error", "failed"],
  "⚠️": ["警告", "注意", "warning", "alert"],
  "🔒": ["锁", "安全", "lock", "secure"],
  "🔓": ["解锁", "unlock"],
  "🔑": ["钥匙", "密码", "key", "password"],
  "🔍": ["搜索", "查找", "search", "find"],
  "⚙️": ["设置", "配置", "setting", "config"],
  "🛠️": ["工具", "开发", "tool", "develop"],
  "💻": ["电脑", "代码", "computer", "code", "developer"],
  "📱": ["手机", "移动端", "phone", "mobile"],
  "🤖": ["机器人", "人工智能", "robot", "ai"],
  "🧠": ["大脑", "思维", "brain", "mind"],
  "🎨": ["设计", "绘画", "design", "art"],
  "🎵": ["音乐", "歌曲", "music", "song"],
  "🎮": ["游戏", "game"],
  "🏆": ["奖杯", "成就", "trophy", "achievement"],
  "📅": ["日历", "日期", "calendar", "date"],
  "⏰": ["闹钟", "提醒", "alarm", "reminder"],
  "📌": ["图钉", "置顶", "pin"],
  "📎": ["附件", "回形针", "attachment", "clip"],
  "🔗": ["链接", "link"],
  "🗑️": ["删除", "垃圾桶", "delete", "trash"],
  "🐱": ["猫", "cat"], "🐶": ["狗", "dog"], "🐼": ["熊猫", "panda"], "🦊": ["狐狸", "fox"],
  "🌸": ["花", "樱花", "flower", "blossom"], "🌿": ["植物", "叶子", "plant", "leaf"],
  "☀️": ["太阳", "晴天", "sun", "sunny"], "🌙": ["月亮", "夜晚", "moon", "night"],
  "🌈": ["彩虹", "rainbow"], "⚡": ["闪电", "快速", "lightning", "fast"],
  "🍎": ["苹果", "apple"], "☕": ["咖啡", "coffee"], "🍵": ["茶", "tea"], "🍰": ["蛋糕", "cake"],
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function filterEmojis(query: string): EmojiSearchResult[] {
  const normalized = normalize(query);
  if (!normalized) {
    return EMOJI_CATEGORIES.flatMap((category) => category.emojis.map((emoji) => ({ emoji, categoryId: category.id })));
  }

  const results: EmojiSearchResult[] = [];
  const seen = new Set<string>();
  for (const category of EMOJI_CATEGORIES) {
    const categoryText = normalize([category.fallbackLabel, category.id, ...category.keywords].join(" "));
    for (const emoji of category.emojis) {
      const aliases = SEARCH_ALIASES[emoji] || [];
      const searchable = normalize([emoji, categoryText, ...aliases].join(" "));
      if (!searchable.includes(normalized) || seen.has(emoji)) continue;
      seen.add(emoji);
      results.push({ emoji, categoryId: category.id });
    }
  }
  return results;
}

export function parseRecentEmojis(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return unique(parsed.filter((item): item is string => typeof item === "string" && ALL_EMOJIS.includes(item)))
      .slice(0, EMOJI_RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function pushRecentEmoji(current: string[], emoji: string): string[] {
  if (!ALL_EMOJIS.includes(emoji)) return current.slice(0, EMOJI_RECENT_LIMIT);
  return [emoji, ...current.filter((item) => item !== emoji)].slice(0, EMOJI_RECENT_LIMIT);
}
