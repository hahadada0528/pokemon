#!/usr/bin/env python3
"""Load gym leaders, Elite Four, and champions, plus a portrait for each.

Teams are six final forms that have combat power in this dex. A gym leader or
Elite Four member's six all share that trainer's type. Each champion's sixth
Pokémon is a legendary from that generation.
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
MON_PATH = DATA / "pokemon.json"
OUT_PATH = DATA / "league.json"
IMG_DIR = DATA / "images" / "trainers"
API = "https://wiki.52poke.com/api.php"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
API_CACHE_PATH = Path("/tmp/league_52poke_cache.json")

TYPE_ZH = {
    "normal": "一般",
    "fire": "火",
    "water": "水",
    "electric": "电",
    "grass": "草",
    "ice": "冰",
    "fighting": "格斗",
    "poison": "毒",
    "ground": "地面",
    "flying": "飞行",
    "psychic": "超能力",
    "bug": "虫",
    "rock": "岩石",
    "ghost": "幽灵",
    "dragon": "龙",
    "dark": "恶",
    "steel": "钢",
    "fairy": "妖精",
}


def person(slug, zh, en, wiki, ptype, team, aliases=None, office="馆主", legendary=None, portrait_bias=None):
    return {
        "slug": slug,
        "name_zh": zh,
        "name_en": en,
        "wiki": wiki,
        "type": ptype,
        "team": team,
        "aliases": aliases or [zh],
        "office": office,
        "legendary": legendary,
        "portrait_bias": portrait_bias,
    }


def gens():
    return [
        {
            "generation": 1,
            "region": "关都",
            "gyms": [
                person("brock", "小刚", "Brock", "Brock", "rock", ["golem", "rhyperior", "tyranitar", "gigalith", "aerodactyl", "coalossal"]),
                person("misty", "小霞", "Misty", "Misty", "water", ["starmie", "gyarados", "milotic", "vaporeon", "swampert", "blastoise"]),
                person("lt-surge", "马志士", "Lt. Surge", "Lt. Surge", "electric", ["raichu", "jolteon", "electivire", "magnezone", "ampharos", "eelektross"], ["马志士", "馬志士"]),
                person("erika", "莉佳", "Erika", "Erika", "grass", ["vileplume", "victreebel", "roserade", "lilligant", "tangrowth", "venusaur"]),
                person("koga", "阿桔", "Koga", "Koga", "poison", ["venomoth", "muk", "crobat", "weezing", "drapion", "nidoking"]),
                person("sabrina", "娜姿", "Sabrina", "Sabrina", "psychic", ["alakazam", "hypno", "gardevoir", "espeon", "metagross", "hatterene"]),
                person("blaine", "夏伯", "Blaine", "Blaine", "fire", ["arcanine", "ninetales", "magmortar", "typhlosion", "rapidash", "charizard"]),
                person("giovanni", "坂木", "Giovanni", "Giovanni", "ground", ["dugtrio", "sandslash", "golem", "rhyperior", "mamoswine", "garchomp"], ["坂木", "阪木"]),
            ],
            "elite": [
                person("lorelei", "科拿", "Lorelei", "Lorelei", "ice", ["cloyster", "dewgong", "lapras", "walrein", "weavile", "mamoswine"], office="四天王"),
                person("bruno", "希巴", "Bruno", "Bruno", "fighting", ["hitmonlee", "hitmonchan", "machamp", "heracross", "lucario", "conkeldurr"], office="四天王"),
                person("agatha", "菊子", "Agatha", "Agatha", "ghost", ["gengar", "mismagius", "banette", "drifblim", "chandelure", "aegislash"], office="四天王"),
                person("lance", "阿渡", "Lance", "Lance", "dragon", ["dragonite", "kingdra", "salamence", "flygon", "garchomp", "hydreigon"], office="四天王"),
            ],
            "champion": person("blue", "青绿", "Blue", "青绿", None, ["pidgeot", "alakazam", "arcanine", "gyarados", "exeggutor", "mewtwo"], ["青绿", "青綠"], "冠军", "mewtwo"),
        },
        {
            "generation": 2,
            "region": "城都",
            "gyms": [
                person("falkner", "阿速", "Falkner", "Falkner", "flying", ["pidgeot", "noctowl", "skarmory", "pelipper", "swellow", "honchkrow"]),
                person("bugsy", "阿笔", "Bugsy", "Bugsy", "bug", ["scizor", "heracross", "forretress", "yanmega", "vespiquen", "volcarona"], ["阿笔", "阿筆"]),
                person("whitney", "小茜", "Whitney", "Whitney", "normal", ["miltank", "tauros", "snorlax", "slaking", "blissey", "porygon-z"]),
                person("morty", "松叶", "Morty", "Morty", "ghost", ["gengar", "mismagius", "banette", "drifblim", "chandelure", "aegislash"], ["松叶", "松葉"]),
                person("chuck", "阿四", "Chuck", "Chuck", "fighting", ["machamp", "poliwrath", "heracross", "hitmontop", "lucario", "conkeldurr"]),
                person("jasmine", "阿蜜", "Jasmine", "Jasmine", "steel", ["steelix", "skarmory", "scizor", "magnezone", "aggron", "metagross"]),
                person("pryce", "柳伯", "Pryce", "Pryce", "ice", ["dewgong", "cloyster", "walrein", "mamoswine", "weavile", "abomasnow"]),
                person("clair", "小椿", "Clair", "Clair", "dragon", ["dragonite", "kingdra", "salamence", "flygon", "garchomp", "dragapult"]),
            ],
            "elite": [
                person("will", "一树", "Will", "Will", "psychic", ["xatu", "jynx", "espeon", "alakazam", "gardevoir", "metagross"], office="四天王"),
                person("koga-johto", "阿桔", "Koga", "Koga", "poison", ["crobat", "venomoth", "weezing", "muk", "toxapex", "drapion"], office="四天王"),
                person("bruno-johto", "希巴", "Bruno", "Bruno", "fighting", ["machamp", "hitmonlee", "hitmonchan", "hariyama", "lucario", "conkeldurr"], office="四天王"),
                person("karen", "梨花", "Karen", "Karen", "dark", ["umbreon", "houndoom", "absol", "honchkrow", "tyranitar", "hydreigon"], office="四天王"),
            ],
            "champion": person("lance-champion", "阿渡", "Lance", "Lance", None, ["dragonite", "kingdra", "salamence", "garchomp", "hydreigon", "ho-oh"], office="冠军", legendary="ho-oh"),
        },
        {
            "generation": 3,
            "region": "丰缘",
            "gyms": [
                person("roxanne", "杜娟", "Roxanne", "Roxanne", "rock", ["golem", "rhyperior", "gigalith", "tyranitar", "aerodactyl", "aggron"]),
                person("brawly", "藤树", "Brawly", "Brawly", "fighting", ["machamp", "hariyama", "heracross", "medicham", "lucario", "conkeldurr"], ["藤树", "藤樹"]),
                person("wattson", "铁旋", "Wattson", "Wattson", "electric", ["manectric", "raichu", "ampharos", "magnezone", "electivire", "eelektross"], ["铁旋", "鐵旋"]),
                person("flannery", "亚莎", "Flannery", "Flannery", "fire", ["torkoal", "camerupt", "arcanine", "ninetales", "magmortar", "blaziken"], ["亚莎", "亞莎"]),
                person("norman", "千里", "Norman", "Norman", "normal", ["slaking", "exploud", "snorlax", "blissey", "tauros", "staraptor"]),
                person("winona", "娜琪", "Winona", "Winona", "flying", ["pelipper", "skarmory", "swellow", "altaria", "honchkrow", "staraptor"]),
                person("tate-liza", "小枫与小南", "Tate and Liza", "小楓與小南", "psychic", ["solrock", "lunatone", "gardevoir", "alakazam", "gallade", "metagross"], ["小枫", "小楓", "小南"]),
                person("wallace", "米可利", "Wallace", "Wallace", "water", ["milotic", "walrein", "gyarados", "swampert", "blastoise", "ludicolo"]),
            ],
            "elite": [
                person("sidney", "花月", "Sidney", "Sidney", "dark", ["sharpedo", "absol", "crawdaunt", "honchkrow", "tyranitar", "hydreigon"], office="四天王"),
                person("phoebe", "芙蓉", "Phoebe", "Phoebe", "ghost", ["banette", "sableye", "mismagius", "drifblim", "chandelure", "aegislash"], office="四天王"),
                person("glacia", "波妮", "Glacia", "Glacia", "ice", ["glalie", "walrein", "froslass", "mamoswine", "weavile", "abomasnow"], office="四天王"),
                person("drake", "源治", "Drake", "Drake", "dragon", ["flygon", "altaria", "salamence", "kingdra", "dragonite", "garchomp"], office="四天王"),
            ],
            "champion": person("steven", "大吾", "Steven", "大吾", None, ["metagross", "aggron", "skarmory", "magnezone", "excadrill", "rayquaza"], office="冠军", legendary="rayquaza"),
        },
        {
            "generation": 4,
            "region": "神奥",
            "gyms": [
                person("roark", "瓢太", "Roark", "Roark", "rock", ["rampardos", "bastiodon", "golem", "rhyperior", "tyranitar", "gigalith"]),
                person("gardenia", "菜种", "Gardenia", "Gardenia", "grass", ["roserade", "torterra", "leafeon", "abomasnow", "tangrowth", "venusaur"], ["菜种", "菜種"]),
                person("maylene", "阿李", "Maylene", "Maylene", "fighting", ["lucario", "medicham", "machamp", "toxicroak", "heracross", "conkeldurr"]),
                person("crasher-wake", "吉宪", "Crasher Wake", "Crasher Wake", "water", ["floatzel", "gyarados", "ludicolo", "quagsire", "swampert", "empoleon"], ["吉宪", "吉憲"]),
                person("fantina", "梅丽莎", "Fantina", "Fantina", "ghost", ["mismagius", "drifblim", "banette", "gengar", "chandelure", "aegislash"], ["梅丽莎", "梅麗莎"]),
                person("byron", "东瓜", "Byron", "Byron", "steel", ["steelix", "bastiodon", "magnezone", "aggron", "empoleon", "metagross"], ["东瓜", "東瓜"]),
                person("candice", "小菘", "Candice", "Candice", "ice", ["abomasnow", "froslass", "weavile", "mamoswine", "glaceon", "walrein"]),
                person("volkner", "电次", "Volkner", "Volkner", "electric", ["luxray", "raichu", "electivire", "magnezone", "ampharos", "eelektross"], ["电次", "電次"]),
            ],
            "elite": [
                person("aaron", "阿柳", "Aaron", "Aaron", "bug", ["beautifly", "dustox", "vespiquen", "heracross", "scizor", "volcarona"], office="四天王"),
                person("bertha", "菊野", "Bertha", "Bertha", "ground", ["whiscash", "hippowdon", "rhyperior", "mamoswine", "gliscor", "garchomp"], office="四天王"),
                person("flint", "大叶", "Flint", "Flint", "fire", ["rapidash", "magmortar", "houndoom", "flareon", "arcanine", "infernape"], ["大叶", "大葉"], "四天王"),
                person("lucian", "悟松", "Lucian", "Lucian", "psychic", ["bronzong", "alakazam", "gallade", "gardevoir", "metagross", "espeon"], office="四天王"),
                ],
            "champion": person("cynthia", "竹兰", "Cynthia", "Cynthia", None, ["spiritomb", "roserade", "togekiss", "lucario", "garchomp", "giratina"], ["竹兰", "竹蘭"], "冠军", "giratina"),
        },
        {
            "generation": 5,
            "region": "合众",
            "gyms": [
                person("cheren", "黑连", "Cheren", "Cheren", "normal", ["stoutland", "unfezant", "watchog", "cinccino", "snorlax", "staraptor"], ["黑连", "黑連"]),
                person("roxie", "霍米加", "Roxie", "Roxie", "poison", ["scolipede", "garbodor", "swalot", "crobat", "drapion", "toxicroak"]),
                person("burgh", "亚堤", "Burgh", "Burgh", "bug", ["leavanny", "scolipede", "crustle", "galvantula", "volcarona", "scizor"], ["亚堤", "亞堤"]),
                person("elesa", "小菊儿", "Elesa", "Elesa", "electric", ["zebstrika", "emolga", "eelektross", "ampharos", "electivire", "luxray"], ["小菊儿", "小菊兒"]),
                person("clay", "菊老大", "Clay", "Clay", "ground", ["excadrill", "krookodile", "stunfisk", "mamoswine", "rhyperior", "garchomp"]),
                person("skyla", "风露", "Skyla", "Skyla", "flying", ["swanna", "unfezant", "skarmory", "braviary", "mandibuzz", "staraptor"], ["风露", "風露"]),
                person("drayden", "夏卡", "Drayden", "Drayden", "dragon", ["haxorus", "druddigon", "flygon", "salamence", "dragonite", "hydreigon"]),
                person("marlon", "西子伊", "Marlon", "Marlon", "water", ["jellicent", "carracosta", "wailord", "swampert", "gyarados", "samurott"]),
            ],
            "elite": [
                person("shauntal", "婉龙", "Shauntal", "婉龍", "ghost", ["cofagrigus", "chandelure", "golurk", "banette", "mismagius", "aegislash"], ["婉龙", "婉龍"], "四天王"),
                person("marshal", "连武", "Marshal", "Marshal", "fighting", ["throh", "sawk", "conkeldurr", "mienshao", "machamp", "lucario"], ["连武", "連武"], "四天王"),
                person("grimsley", "越橘", "Grimsley", "Grimsley", "dark", ["liepard", "scrafty", "krookodile", "kingambit", "honchkrow", "hydreigon"], office="四天王"),
                person("caitlin", "嘉德丽雅", "Caitlin", "Caitlin", "psychic", ["musharna", "reuniclus", "gothitelle", "sigilyph", "metagross", "alakazam"], ["嘉德丽雅", "嘉德麗雅"], "四天王"),
            ],
            "champion": person("iris", "艾莉丝", "Iris", "Iris", None, ["haxorus", "dragonite", "salamence", "hydreigon", "garchomp", "zekrom"], ["艾莉丝", "艾莉絲"], "冠军", "zekrom"),
        },
        {
            "generation": 6,
            "region": "卡洛斯",
            "gyms": [
                person("viola", "紫罗兰", "Viola", "Viola", "bug", ["vivillon", "galvantula", "scizor", "heracross", "volcarona", "leavanny"], ["紫罗兰", "紫羅蘭"]),
                person("grant", "查克洛", "Grant", "Grant", "rock", ["tyrantrum", "aurorus", "gigalith", "tyranitar", "aerodactyl", "coalossal"]),
                person("korrina", "可尔妮", "Korrina", "Korrina", "fighting", ["lucario", "machamp", "mienshao", "heracross", "hawlucha", "conkeldurr"], ["可尔妮", "可爾妮"]),
                person("ramos", "福爷", "Ramos", "Ramos", "grass", ["gogoat", "jumpluff", "roserade", "venusaur", "torterra", "tangrowth"], ["福爷", "福爺"]),
                person("clemont", "希特隆", "Clemont", "Clemont", "electric", ["heliolisk", "emolga", "ampharos", "magnezone", "electivire", "eelektross"]),
                person("valerie", "玛绣", "Valerie", "Valerie", "fairy", ["sylveon", "florges", "gardevoir", "togekiss", "whimsicott", "hatterene"], ["玛绣", "瑪繡"]),
                person("olympia", "葛吉花", "Olympia", "Olympia", "psychic", ["meowstic", "sigilyph", "alakazam", "gardevoir", "metagross", "reuniclus"]),
                person("wulfric", "得抚", "Wulfric", "Wulfric", "ice", ["avalugg", "abomasnow", "mamoswine", "weavile", "glaceon", "froslass"], ["得抚", "得撫"]),
            ],
            "elite": [
                person("malva", "帕琦拉", "Malva", "Malva", "fire", ["pyroar", "talonflame", "torkoal", "arcanine", "chandelure", "volcarona"], office="四天王"),
                person("siebold", "志米", "Siebold", "Siebold", "water", ["clawitzer", "barbaracle", "gyarados", "starmie", "milotic", "greninja"], office="四天王"),
                person("wikstrom", "雁铠", "Wikstrom", "Wikstrom", "steel", ["klefki", "aegislash", "scizor", "probopass", "aggron", "metagross"], ["雁铠", "雁鎧"], "四天王"),
                person("drasna", "朵拉塞娜", "Drasna", "Drasna", "dragon", ["dragalge", "noivern", "dragonite", "salamence", "garchomp", "hydreigon"], office="四天王"),
            ],
            "champion": person("diantha", "卡露妮", "Diantha", "Diantha", None, ["hawlucha", "tyrantrum", "goodra", "gourgeist", "gardevoir", "xerneas"], ["卡露妮"], "冠军", "xerneas"),
        },
        {
            "generation": 7,
            "region": "阿罗拉",
            "gyms": [
                person("ilima", "伊利马", "Ilima", "Ilima", "normal", ["gumshoos", "stoutland", "snorlax", "blissey", "slaking", "tauros"], ["伊利马", "伊利馬"], "队长"),
                person("lana", "水莲", "Lana", "Lana", "water", ["araquanid", "milotic", "gyarados", "primarina", "toxapex", "swampert"], ["水莲", "水蓮"], "队长"),
                person("kiawe", "卡奇", "Kiawe", "Kiawe", "fire", ["salazzle", "turtonator", "arcanine", "incineroar", "talonflame", "magmortar"], office="队长"),
                person("mallow", "玛奥", "Mallow", "Mallow", "grass", ["lurantis", "tsareena", "decidueye", "venusaur", "roserade", "tangrowth"], ["玛奥", "瑪奧"], "队长"),
                person("sophocles", "马玛内", "Sophocles", "Sophocles", "electric", ["vikavolt", "togedemaru", "raichu-alola", "magnezone", "electivire", "eelektross"], ["马玛内", "馬瑪內"], "队长"),
                person("acerola", "阿塞萝拉", "Acerola", "Acerola", "ghost", ["palossand", "mimikyu", "drifblim", "chandelure", "gengar", "aegislash"], ["阿塞萝拉", "阿塞蘿拉"], "队长"),
                person("mina", "玛琳", "Mina", "Mina", "fairy", ["ribombee", "wigglytuff", "sylveon", "florges", "gardevoir", "togekiss"], ["玛琳", "瑪琳", "茉莉"], "队长", portrait_bias="USUM"),
                person("hapu", "哈普乌", "Hapu", "Hapu", "ground", ["mudsdale", "gastrodon", "mamoswine", "rhyperior", "excadrill", "garchomp"], ["哈普乌", "哈普烏"], "岛屿之王"),
            ],
            "elite": [
                person("hala", "哈拉", "Hala", "Hala", "fighting", ["hariyama", "crabominable", "bewear", "machamp", "lucario", "conkeldurr"], office="四天王"),
                person("olivia", "丽姿", "Olivia", "Olivia", "rock", ["lycanroc", "gigalith", "probopass", "tyranitar", "aerodactyl", "coalossal"], ["丽姿", "麗姿"], "四天王"),
                person("acerola-elite", "阿塞萝拉", "Acerola", "Acerola", "ghost", ["mimikyu", "palossand", "banette", "drifblim", "chandelure", "aegislash"], ["阿塞萝拉", "阿塞蘿拉"], "四天王"),
                person("kahili", "卡希丽", "Kahili", "Kahili", "flying", ["oricorio", "crobat", "braviary", "mandibuzz", "skarmory", "staraptor"], ["卡希丽", "卡希麗"], "四天王"),
            ],
            "champion": person("kukui", "库库伊", "Kukui", "Kukui", None, ["lycanroc", "ninetales-alola", "snorlax", "incineroar", "braviary", "solgaleo"], ["库库伊", "庫庫伊"], "冠军", "solgaleo"),
        },
        {
            "generation": 8,
            "region": "伽勒尔",
            "gyms": [
                person("milo", "亚洛", "Milo", "Milo", "grass", ["eldegoss", "flapple", "appletun", "rillaboom", "roserade", "venusaur"], ["亚洛", "亞洛"]),
                person("nessa", "露璃娜", "Nessa", "Nessa", "water", ["drednaw", "barraskewda", "inteleon", "gyarados", "toxapex", "milotic"]),
                person("kabu", "卡芜", "Kabu", "Kabu", "fire", ["centiskorch", "ninetales", "arcanine", "cinderace", "chandelure", "volcarona"], ["卡芜", "卡蕪"]),
                person("bea", "彩豆", "Bea", "Bea", "fighting", ["machamp", "sirfetchd", "falinks", "lucario", "hawlucha", "conkeldurr"]),
                person("opal", "波普菈", "Opal", "Opal", "fairy", ["togekiss", "alcremie", "hatterene", "gardevoir", "sylveon", "florges"]),
                person("gordie", "玛瓜", "Gordie", "Gordie", "rock", ["coalossal", "stonjourner", "gigalith", "tyranitar", "rhyperior", "aerodactyl"], ["玛瓜", "瑪瓜"]),
                person("piers", "聂梓", "Piers", "Piers", "dark", ["obstagoon", "skuntank", "scrafty", "tyranitar", "hydreigon", "grimmsnarl"], ["聂梓", "聶梓"]),
                person("raihan", "奇巴纳", "Raihan", "Raihan", "dragon", ["flygon", "dragapult", "dragonite", "salamence", "garchomp", "archaludon"], ["奇巴纳", "奇巴納"]),
            ],
            "elite": [
                person("hop", "赫普", "Hop", "Hop", "fighting", ["kommo-o", "annihilape", "gallade", "heracross", "pawmot", "grapploct"], ["赫普"], "四天王"),
                person("marnie", "玛俐", "Marnie", "Marnie", "dark", ["grimmsnarl", "kingambit", "incineroar", "krookodile", "honchkrow", "weavile"], ["玛俐", "瑪俐"], "四天王"),
                person("klara", "克拉拉", "Klara", "克拉拉", "poison", ["slowbro-galar", "nidoking", "drapion", "gengar", "toxtricity", "salazzle"], ["克拉拉"], "四天王"),
                person("avery", "赛宝利", "Avery", "赛宝利", "psychic", ["slowking-galar", "orbeetle", "espeon", "gardevoir", "gallade", "exeggutor"], ["赛宝利"], "四天王"),
            ],
            "champion": person("leon", "丹帝", "Leon", "Leon", None, ["aegislash", "dragapult", "haxorus", "rhyperior", "charizard", "zacian"], office="冠军", legendary="zacian"),
        },
        {
            "generation": 8,
            "region": "洗翠",
            "gyms": [
                person("mai", "阿米", "Mai", "阿米", "normal", ["wyrdeer", "snorlax", "porygon-z", "slaking", "obstagoon", "staraptor"], ["阿米"], "宝主"),
                person("lian", "菊伊", "Lian", "菊伊", "bug", ["kleavor", "volcarona", "orbeetle", "scizor", "heracross", "scolipede"], ["菊伊"], "宝主"),
                person("arezu", "火夏", "Arezu", "火夏", "grass", ["lilligant-hisui", "meowscarada", "rillaboom", "decidueye-hisui", "serperior", "sceptile"], ["火夏"], "宝主"),
                person("iscan", "阿芒", "Iscan", "阿芒", "water", ["basculegion", "swampert", "gyarados", "greninja", "empoleon", "primarina"], ["阿芒"], "宝主"),
                person("palina", "瓜娜", "Palina", "瓜娜", "fire", ["arcanine-hisui", "magmortar", "cinderace", "charizard", "typhlosion", "chandelure"], ["瓜娜"], "宝主"),
                person("ingo", "北尚", "Ingo", "北尚", "fighting", ["sneasler", "kommo-o", "annihilape", "lucario", "machamp", "conkeldurr"], ["北尚"], "宝主"),
                person("melli", "木春", "Melli", "木春", "electric", ["electrode-hisui", "magnezone", "electivire", "jolteon", "eelektross", "ampharos"], ["木春"], "宝主"),
                person("gaeric", "滨廉", "Gaeric", "濱廉", "ice", ["avalugg-hisui", "baxcalibur", "glaceon", "walrein", "weavile", "mamoswine"], ["滨廉", "濱廉"], "宝主"),
                person("sabi", "山葵", "Sabi", "山葵", "psychic", ["braviary-hisui", "metagross", "espeon", "exeggutor", "gardevoir", "gallade"], ["山葵"], "宝主"),
                person("calaba", "夕蒲", "Calaba", "夕蒲", "ground", ["ursaluna", "garchomp", "rhyperior", "swampert", "krookodile", "nidoking"], ["夕蒲"], "宝主"),
            ],
            "elite": [
                person("adaman", "刚石", "Adaman", "剛石", "grass", ["leafeon", "venusaur", "torterra", "exeggutor", "meowscarada", "rillaboom"], ["刚石", "剛石"], "钻石队首领"),
                person("irida", "珠贝", "Irida", "珠貝", "ice", ["glaceon", "weavile", "walrein", "baxcalibur", "cetitan", "froslass"], ["珠贝", "珠貝"], "珍珠队首领"),
                person("kamado", "马加木", "Kamado", "馬加木", "fire", ["arcanine-hisui", "incineroar", "blaziken", "infernape", "volcarona", "delphox"], ["马加木", "馬加木"], "银河队队长"),
                person("beni", "石月", "Beni", "石月", "poison", ["sneasler", "glimmora", "nidoking", "nidoqueen", "gengar", "drapion"], ["石月"], "银河队"),
            ],
            "champion": person("volo", "望罗", "Volo", "望羅", None, ["spiritomb", "togekiss", "lucario", "garchomp", "arcanine-hisui", "giratina"], ["望罗", "望羅"], "最终对手", "giratina"),
        },
        {
            "generation": 9,
            "region": "帕底亚",
            "gyms": [
                person("katy", "阿枫", "Katy", "Katy", "bug", ["spidops", "lokix", "scizor", "heracross", "volcarona", "yanmega"], ["阿枫", "阿楓"]),
                person("brassius", "寇沙", "Brassius", "Brassius", "grass", ["arboliva", "lilligant", "meowscarada", "roserade", "venusaur", "torterra"]),
                person("iono", "奇树", "Iono", "Iono", "electric", ["bellibolt", "kilowattrel", "raichu", "ampharos", "magnezone", "eelektross"], ["奇树", "奇樹"]),
                person("kofu", "海岱", "Kofu", "Kofu", "water", ["wugtrio", "veluza", "tatsugiri", "dondozo", "greninja", "milotic"]),
                person("larry", "青木", "Larry", "Larry", "normal", ["dudunsparce", "komala", "snorlax", "slaking", "blissey", "staraptor"]),
                person("ryme", "莱姆", "Ryme", "Ryme", "ghost", ["houndstone", "mimikyu", "banette", "chandelure", "gengar", "aegislash"], ["莱姆", "萊姆"]),
                person("tulip", "莉普", "Tulip", "Tulip", "psychic", ["espathra", "farigiraf", "gardevoir", "alakazam", "metagross", "reuniclus"]),
                person("grusha", "古鲁夏", "Grusha", "Grusha", "ice", ["cetitan", "baxcalibur", "mamoswine", "weavile", "glaceon", "abomasnow"], ["古鲁夏", "古魯夏"]),
            ],
            "elite": [
                person("rika", "辛俐", "Rika", "Rika", "ground", ["clodsire", "donphan", "hippowdon", "excadrill", "mamoswine", "garchomp"], office="四天王"),
                person("poppy", "波琵", "Poppy", "Poppy", "steel", ["tinkaton", "corviknight", "copperajah", "scizor", "aggron", "metagross"], office="四天王"),
                person("larry-elite", "青木", "Larry", "Larry", "flying", ["flamigo", "altaria", "crobat", "braviary", "mandibuzz", "staraptor"], office="四天王"),
                person("hassel", "八朔", "Hassel", "Hassel", "dragon", ["baxcalibur", "dragapult", "dragonite", "salamence", "garchomp", "hydreigon"], office="四天王"),
            ],
            "champion": person("geeta", "也慈", "Geeta", "Geeta", None, ["glimmora", "kingambit", "veluza", "espeon", "gogoat", "koraidon"], office="冠军", legendary="koraidon"),
        },
    ]


FOLD = str.maketrans({
    "樹": "树", "筆": "笔", "葉": "叶", "憲": "宪", "連": "连", "亞": "亚", "兒": "儿",
    "風": "风", "龍": "龙", "麗": "丽", "絲": "丝", "馬": "马", "奧": "奥", "蘿": "萝",
    "庫": "库", "蕪": "芜", "萊": "莱", "魯": "鲁", "楓": "枫", "瑪": "玛", "爾": "尔",
    "蓮": "莲", "蘭": "兰", "羅": "罗", "盧": "卢", "發": "发", "東": "东", "電": "电",
    "雲": "云", "來": "来", "個": "个", "門": "门", "長": "长", "車": "车", "後": "后",
    "為": "为", "國": "国", "關": "关", "開": "开", "學": "学", "時": "时", "會": "会",
    "對": "对", "過": "过", "還": "还", "這": "这", "見": "见", "現": "现", "問": "问",
    "說": "说", "們": "们", "氣": "气", "繡": "绣", "齊": "齐", "達": "达", "遠": "远",
    "輝": "辉", "華": "华", "寶": "宝", "夢": "梦", "傑": "杰", "倫": "伦", "納": "纳",
    "維": "维", "薩": "萨", "諾": "诺", "貝": "贝", "鬥": "斗", "蟲": "虫", "巖": "岩",
    "綉": "绣", "茲": "兹", "剛": "刚", "濱": "滨",
})


def fold(text: str) -> str:
    return text.translate(FOLD)


_api_cache: dict[str, dict] | None = None
_api_writes = 0


def api(params: dict) -> dict:
    global _api_cache, _api_writes
    if _api_cache is None:
        try:
            _api_cache = json.loads(API_CACHE_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            _api_cache = {}
    key = json.dumps(params, sort_keys=True, ensure_ascii=False)
    cached = _api_cache.get(key)
    if cached:
        return cached
    cmd = ["curl", "-fsSL", "-A", UA, "--max-time", "30", "-G", API, "--data-urlencode", "format=json"]
    for key_name, value in params.items():
        cmd += ["--data-urlencode", f"{key_name}={value}"]
    last = None
    for attempt in range(4):
        try:
            result = subprocess.run(cmd, capture_output=True, check=False)
            if result.returncode == 0 and result.stdout:
                data = json.loads(result.stdout.decode("utf-8"))
                _api_cache[key] = data
                _api_writes += 1
                if _api_writes % 25 == 0:
                    API_CACHE_PATH.write_text(json.dumps(_api_cache, ensure_ascii=False))
                return data
            last = result.stderr.decode("utf-8", errors="replace") or f"exit {result.returncode}"
        except Exception as exc:  # noqa: BLE001
            last = str(exc)
        time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"wiki api failed: {last}")


def list_images(title: str) -> tuple[str, list[str]]:
    cont = None
    resolved = title
    found: list[str] = []
    while True:
        params = {
            "action": "query",
            "titles": title if cont is None else resolved,
            "redirects": "1",
            "prop": "images",
            "imlimit": "500",
        }
        if cont:
            params["imcontinue"] = cont
        data = api(params)
        redirects = data.get("query", {}).get("redirects") or []
        if redirects:
            resolved = redirects[-1]["to"]
        pages = data["query"]["pages"]
        for page in pages.values():
            if "missing" in page:
                raise RuntimeError(f"wiki page missing: {title}")
            resolved = page.get("title") or resolved
            for image in page.get("images") or []:
                found.append(image["title"])
        nxt = data.get("continue", {}).get("imcontinue")
        if not nxt:
            break
        cont = nxt
    return resolved, found


def image_info(titles: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for start in range(0, len(titles), 40):
        chunk = titles[start : start + 40]
        data = api({
            "action": "query",
            "prop": "imageinfo",
            "iiprop": "url|size|mime",
            "titles": "|".join(chunk),
        })
        for page in data["query"]["pages"].values():
            info = (page.get("imageinfo") or [None])[0]
            if info and info.get("url"):
                out[page["title"]] = info
        time.sleep(0.15)
    return out


def junk_title(title: str) -> bool:
    return any(word in title for word in ("Sprite", "Bag", "TCG", "套装", "套裝", "EX", "OD", "★", "卡套", "GOTCHA", "金鱼王", "動畫", "动画", "icon", "形象"))


def has_alias(title: str, aliases: list[str]) -> bool:
    folded = fold(title)
    return any(alias and fold(alias) in folded for alias in aliases)


def choose_portrait(aliases: list[str], titles: list[str], infos: dict[str, dict], bias: str | None = None) -> tuple[str, dict]:
    def known(title: str) -> bool:
        return title in infos and has_alias(title, aliases) and title.endswith(".png") and not junk_title(title)

    def clean(title: str) -> bool:
        return "（" not in title and "(" not in title and not any(ch.isdigit() for ch in title)

    def best_of(pool: list[str]) -> str | None:
        if not pool:
            return None
        return max(pool, key=lambda title: infos[title]["width"] * infos[title]["height"])

    def long_side(title: str) -> int:
        return max(infos[title]["width"], infos[title]["height"])

    usable = [title for title in dict.fromkeys(titles) if known(title)]
    vs = [title for title in usable if title.startswith("File:VS ") and "Masters" not in title]
    vs_main = [title for title in vs if clean(title) and " GO" not in title]
    large = [title for title in vs_main if long_side(title) >= 240]
    if bias:
        biased = [title for title in large if bias in title]
        if biased:
            large = biased
    vs_best = best_of(large)
    if vs_best:
        return vs_best, infos[vs_best]

    masters = [title for title in usable if title.endswith("Masters.png") and clean(title)]
    masters_best = best_of(masters)
    if masters_best and long_side(masters_best) >= 240:
        return masters_best, infos[masters_best]

    artwork = [
        title for title in usable
        if clean(title) and not title.startswith("File:VS ") and "Masters" not in title and "形象" not in title
    ]
    art_best = best_of(artwork)
    if art_best:
        return art_best, infos[art_best]
    for pool in (vs_main, [title for title in vs if clean(title)], masters, usable):
        pick = best_of(pool)
        if pick:
            return pick, infos[pick]
    raise RuntimeError(f"no portrait for {aliases}")


def curl_file(url: str, dest: Path) -> None:
    last = None
    for attempt in range(4):
        result = subprocess.run(
            ["curl", "-fsSL", "-A", UA, "-e", "https://wiki.52poke.com/", "--max-time", "60", "-o", str(dest), url],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0 and dest.exists() and dest.stat().st_size > 800 and dest.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n":
            return
        last = result.stderr.decode("utf-8", errors="replace") or f"exit {result.returncode}"
        dest.unlink(missing_ok=True)
        time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"download failed {url}: {last}")


def main() -> None:
    mons = json.loads(MON_PATH.read_text())
    by_ident = {mon["identifier"]: mon for mon in mons}
    IMG_DIR.mkdir(parents=True, exist_ok=True)

    def mon_brief(ident: str, need_type: str | None) -> dict:
        mon = by_ident.get(ident)
        if not mon:
            raise SystemExit(f"missing pokemon {ident}")
        evolves = (mon.get("evolution") or {}).get("evolves_to") or []
        if evolves or mon.get("mega_form") or mon.get("alt_form") or mon.get("mega_of") or mon.get("alt_of"):
            raise SystemExit(f"{ident} has no independent combat power")
        if not mon.get("species_power"):
            raise SystemExit(f"{ident} has no species power")
        if need_type and need_type not in (mon.get("types") or []):
            raise SystemExit(f"{ident} is not {need_type}")
        return {"id": mon["id"], "identifier": ident, "name_zh": mon["name_zh"], "types": mon["types"]}

    generations = gens()
    portrait_for: dict[str, str] = {}
    needed: dict[str, dict] = {}
    for gen in generations:
        people = [*gen["gyms"], *gen["elite"], gen["champion"]]
        for trainer in people:
            needed.setdefault(trainer["wiki"], trainer)

    print(f"resolving {len(needed)} wiki pages", flush=True)
    chosen: dict[str, tuple[str, dict]] = {}
    for wiki, trainer in needed.items():
        titles: list[str] = []
        for guess in dict.fromkeys((wiki, trainer["name_zh"], *trainer["aliases"])):
            try:
                _resolved, found = list_images(guess)
            except RuntimeError:
                continue
            titles.extend(found)
        if not titles:
            raise SystemExit(f"wiki page missing for {trainer['name_zh']}")
        candidates = [
            title for title in dict.fromkeys(titles)
            if has_alias(title, trainer["aliases"])
            and title.endswith(".png")
            and not junk_title(title)
        ]
        if not candidates:
            raise SystemExit(f"no portrait candidates for {trainer['name_zh']}")
        infos = image_info(candidates)
        file_title, info = choose_portrait(trainer["aliases"], titles, infos, trainer.get("portrait_bias"))
        chosen[wiki] = (file_title, info)
        print(f"  {trainer['name_zh']}: {file_title} {info['width']}x{info['height']}", flush=True)
        time.sleep(0.1)
    if _api_cache is not None:
        API_CACHE_PATH.write_text(json.dumps(_api_cache, ensure_ascii=False))

    for gen in generations:
        for trainer in [*gen["gyms"], *gen["elite"], gen["champion"]]:
            if trainer["wiki"] in ("Koga", "Bruno", "Lance", "Acerola", "Larry"):
                file_slug = {
                    "Koga": "koga",
                    "Bruno": "bruno",
                    "Lance": "lance",
                    "Acerola": "acerola",
                    "Larry": "larry",
                }[trainer["wiki"]]
            else:
                file_slug = trainer["slug"]
            dest = IMG_DIR / f"{file_slug}.png"
            _title, info = chosen[trainer["wiki"]]
            sources = IMG_DIR / "_sources.json"
            if not hasattr(main, "sources"):
                try:
                    main.sources = json.loads(sources.read_text())
                except (OSError, json.JSONDecodeError):
                    main.sources = {}
            if not dest.exists() or main.sources.get(file_slug) != _title:
                curl_file(info["url"], dest)
                main.sources[file_slug] = _title
                sources.write_text(json.dumps(main.sources, ensure_ascii=False, indent=2) + "\n")
                print(f"saved {dest.name} {dest.stat().st_size}", flush=True)
            trainer["image"] = f"images/trainers/{file_slug}.png"
            trainer["portrait"] = _title
            need_type = trainer["type"]
            if trainer["office"] == "冠军":
                need_type = None
            roster = [mon_brief(ident, need_type) for ident in trainer["team"]]
            if len(roster) != 6 or len({row["id"] for row in roster}) != 6:
                raise SystemExit(f"{trainer['name_zh']} team is not six unique pokemon")
            if trainer["legendary"]:
                legend = by_ident[trainer["legendary"]]
                if not (legend.get("is_legendary") or legend.get("is_mythical")):
                    raise SystemExit(f"{trainer['legendary']} is not a legendary")
                if roster[-1]["identifier"] != trainer["legendary"]:
                    raise SystemExit(f"{trainer['name_zh']} legendary is not the last team slot")
            trainer["pokemon"] = roster

    payload = {"generations": []}
    for gen in generations:
        def emit(trainer: dict, role: str) -> dict:
            body = {
                "slug": trainer["slug"],
                "name_zh": trainer["name_zh"],
                "name_en": trainer["name_en"],
                "role": role,
                "office": trainer["office"],
                "image": trainer["image"],
                "pokemon": trainer["pokemon"],
            }
            if trainer["type"]:
                body["type"] = trainer["type"]
                body["type_zh"] = TYPE_ZH[trainer["type"]]
            if trainer["legendary"]:
                body["legendary_id"] = by_ident[trainer["legendary"]]["id"]
            return body

        block = {
            "generation": gen["generation"],
            "region": gen["region"],
            "gyms": [emit(trainer, "gym") for trainer in gen["gyms"]],
            "elite_four": [emit(trainer, "elite") for trainer in gen["elite"]],
            "champion": emit(gen["champion"], "champion"),
        }
        if gen.get("note"):
            block["note"] = gen["note"]
        payload["generations"].append(block)

    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    gyms = sum(len(gen["gyms"]) for gen in payload["generations"])
    elites = sum(len(gen["elite_four"]) for gen in payload["generations"])
    print(f"wrote {OUT_PATH} gyms={gyms} elite={elites} champions={len(payload['generations'])}")


if __name__ == "__main__":
    main()
