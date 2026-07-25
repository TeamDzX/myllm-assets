#!/usr/bin/env python3
"""Assemble langpacks/sk.json (Slovak → "Petra") and validate deck lengths
against catalog_en.json so word/image alignment can't drift."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CAT = {d["id"]: [c["en"] for c in d["cards"]] for d in json.load(open(os.path.join(HERE, "catalog_en.json")))}

DECKS = {
    "fruits": ["jablko","banán","pomaranč","hrozno","dyňa","jahoda","broskyňa","hruška","mango","ananás","čerešňa","citrón","kokos","čučoriedka","pomelo"],
    "vegetables": ["paradajka","zemiak","mrkva","čínska kapusta","uhorka","baklažán","cibuľa","šampiňón","kukurica","čili paprička","špenát","tekvica","zelená paprika","cesnak","zelené fazuľky"],
    "food": ["ryža","rezance","chlieb","ovocie","jablko","banán","pomaranč","zelenina","mäso","kuracie mäso","hovädzie mäso","ryba","voda","čaj","káva","mlieko","džús"],
    "drinks": ["voda","čaj","káva","mlieko","džús","kola","pivo","červené víno","sójové mlieko","mliečny čaj","sóda","minerálka","kokosová voda","horúca čokoláda","limonáda"],
    "family": ["rodina","otec","mama","starší brat","mladší brat","staršia sestra","mladšia sestra","starý otec","stará mama","dedko","babka","manžel","manželka","syn","dcéra"],
    "body": ["hlava","tvár","oko","ucho","nos","ústa","zub","jazyk","krk","plece","ruka","dlaň","prst","noha","chodidlo","srdce","žalúdok","chrbát"],
    "clothing": ["košeľa","nohavice","sukňa","kabát","topánky","klobúk","ponožky","rukavice","šál","sveter","šaty","rifle","oblek","mikina","okuliare"],
    "transport": ["lietadlo","vlak","rýchlovlak","metro","autobus","taxík","bicykel","auto","motorka","loď","letisko","stanica","lístok","vízum","batožina","sprievodca","cestovanie","mapa"],
    "home": ["posteľ","stôl","stolička","gauč","dvere","okno","lampa","chladnička","televízor","zrkadlo","hodiny","polica na knihy","kuchyňa","spálňa","kúpeľňa"],
    "town": ["škola","nemocnica","banka","park","supermarket","reštaurácia","knižnica","kino","pošta","železničná stanica","letisko","obchod","hotel","kancelárska budova","námestie"],
}

# validate lengths against the shared image catalog
errs = []
for did, words in DECKS.items():
    n = len(CAT.get(did, []))
    if n == 0: errs.append(f"{did}: not in catalog")
    elif len(words) != n: errs.append(f"{did}: {len(words)} words vs {n} images")
if errs:
    print("DECK MISMATCH:\n  " + "\n  ".join(errs)); sys.exit(1)

STARTER_PHRASES = [
    {"topic": "Greetings & basics", "items": [
        {"t": "Ahoj", "p": "AH-hoy", "n": "Hi (informal)"},
        {"t": "Dobrý deň", "p": "DOH-bree dyeñ", "n": "Hello (formal)"},
        {"t": "Prosím", "p": "PROH-seem", "n": "Please"},
        {"t": "Ďakujem", "p": "DYAH-koo-yem", "n": "Thank you"},
        {"t": "Nie je za čo", "p": "nyeh yeh ZAH cho", "n": "You're welcome"},
        {"t": "Ako sa máš?", "p": "AH-ko sa mahsh", "n": "How are you?"},
        {"t": "Volám sa…", "p": "VOH-lahm sa", "n": "My name is…"},
        {"t": "Dovidenia", "p": "doh-vee-DYEH-nya", "n": "Goodbye"},
    ]},
    {"topic": "Eating out", "items": [
        {"t": "Stôl pre dvoch, prosím", "p": "stohl pre dvokh", "n": "A table for two, please"},
        {"t": "Čo mi odporúčate?", "p": "cho mee OD-po-roo-cha-tye", "n": "What do you recommend?"},
        {"t": "Dám si kávu, prosím", "p": "dahm see KAH-voo", "n": "I'll have a coffee, please"},
        {"t": "Som vegetarián", "p": "som ve-ge-ta-RYAHN", "n": "I'm vegetarian"},
        {"t": "Je to výborné!", "p": "yeh to VEE-bor-nye", "n": "It's delicious!"},
        {"t": "Vodu bez bublín, prosím", "p": "VOH-doo bez boob-LEEN", "n": "Still water, please"},
        {"t": "Máte anglický jedálny lístok?", "p": "MAH-tye AN-glits-kee", "n": "Do you have an English menu?"},
        {"t": "Účet, prosím", "p": "OO-chet", "n": "The bill, please"},
    ]},
    {"topic": "Getting around", "items": [
        {"t": "Kde je toaleta?", "p": "kdye yeh to-a-LEH-ta", "n": "Where is the toilet?"},
        {"t": "Koľko to stojí?", "p": "KOL-ko to STOH-yee", "n": "How much is it?"},
        {"t": "Kde je stanica?", "p": "kdye yeh STAH-nee-tsa", "n": "Where is the station?"},
        {"t": "Jeden lístok do Bratislavy, prosím", "p": "YEH-den LEES-tok", "n": "One ticket to Bratislava, please"},
        {"t": "Hovoríte po anglicky?", "p": "ho-VOH-ree-tye po AN-glits-kee", "n": "Do you speak English?"},
        {"t": "Nerozumiem", "p": "ne-ROH-zoo-myem", "n": "I don't understand"},
        {"t": "Môžete mi pomôcť?", "p": "MWO-zhe-tye mee PO-mwotst", "n": "Can you help me?"},
        {"t": "Vľavo / vpravo", "p": "VLYAH-vo / VPRAH-vo", "n": "Left / right"},
    ]},
]

STARTER_GRAMMAR = [
    {"title": "No articles, three genders",
     "rule": "Slovak has no ‘a’ or ‘the’. Every noun is masculine, feminine or neuter — usually shown by the ending: a consonant is masculine, -a is feminine, -o/-e is neuter.",
     "ex": [["muž", "a/the man (masculine)"], ["žena", "a/the woman (feminine)"], ["mesto", "a/the town (neuter)"]]},
    {"title": "The six cases",
     "rule": "Noun endings change with the word’s job in the sentence — subject, object, ‘of’, ‘to’, and so on. There are six cases. Don’t memorise tables yet; just notice the ending shift.",
     "ex": [["To je Petra.", "This is Petra. (subject)"], ["Vidím Petru.", "I see Petra. (object)"], ["kniha Petry", "Petra’s book (‘of’)"]]},
    {"title": "The verb ‘to be’ (byť)",
     "rule": "som (I am), si (you are), je (he/she/it is), sme (we are), ste (you are — plural/polite), sú (they are).",
     "ex": [["Som unavený.", "I am tired."], ["Si tu?", "Are you here?"], ["Sme doma.", "We are at home."]]},
    {"title": "Present tense",
     "rule": "Most verbs take the endings -m, -š, –, -me, -te, -ú/-ia. e.g. robiť (to do) → robím, robíš, robí, robíme, robíte, robia.",
     "ex": [["Hovorím po slovensky.", "I speak Slovak."], ["Čo robíš?", "What are you doing?"], ["Bývame v Bratislave.", "We live in Bratislava."]]},
    {"title": "Adjectives agree",
     "rule": "An adjective changes its ending to match the noun’s gender: -ý (m), -á (f), -é (n).",
     "ex": [["dobrý deň", "good day (m)"], ["dobrá káva", "good coffee (f)"], ["dobré ráno", "good morning (n)"]]},
]

sk = {
    "code": "sk", "name": "Slovak", "native": "Slovenčina", "flag": "🇸🇰",
    "accent": "#0b4ea2", "accent2": "#ee1c25", "iconColor": "blue", "hello": "Ahoj!",
    # Petra branding (build_language.py picks these up)
    "appName": "Petra", "slug": "petra",
    "subtitle": "Slovenčina · grammar & flashcards",
    "tagline": "Learn Slovak with Petra",
    "tags": ["learning", "languages", "AI-powered", "offline"],
    "description": ("Meet Petra, your friendly Slovak tutor. Start with the essentials of Slovak "
                    "grammar — no articles and three genders, the six cases, the verb ‘to be’, "
                    "present-tense verbs and adjective agreement — explained simply with examples. "
                    "Then build vocabulary with illustrated picture flashcards across everyday topics "
                    "(each word has a photo), plus starter phrase packs for greetings, eating out and "
                    "getting around. Ask Petra to explain any grammar point or generate phrases on any "
                    "topic using your on-device AI. Everything except the AI tutor works offline."),
    "decks": DECKS,
    "starterPhrases": STARTER_PHRASES,
    "starterGrammar": STARTER_GRAMMAR,
}
json.dump(sk, open(os.path.join(HERE, "sk.json"), "w"), ensure_ascii=False, indent=1)
print("wrote sk.json —", sum(len(w) for w in DECKS.values()), "words across", len(DECKS), "decks")
