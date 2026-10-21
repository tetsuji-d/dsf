import {basicLayoutLanguageKey} from './basic-layout-context.js';
// Samples are editorial starting points; UI labels remain in the UI language.
const packs={
    ja:['リードのタイトル','伝えたいことを短く紹介します。','著者名','第一章','伝えたいこと','一つのページで伝えることを絞り、短い段落に分けましょう。\n\n長くなるときは、文字を小さくせず次のページへ分けます。','写真で見てほしいことを、短い文章で説明します。',['準備する','試す','確かめる'],'手順を短い言葉で\n具体的に説明します。','三つの手順'],
    en:['Your read title','Introduce your story in a few clear words.','Author name','CHAPTER 1','A clear heading','Focus on one main idea.\n\nUse short paragraphs. Add another page instead of shrinking the letters.','Describe what matters in this photo.',['Get ready','Try it','Check'],'Describe this step in a few clear words.','Three steps'],
    'zh-tw':['作品標題','用簡短的文字介紹作品。','作者姓名','第一章','重要的訊息','每一頁聚焦一個重點，分成簡短的段落。\n\n內容較長時，請增加頁面，不要縮小文字。','用簡短的文字說明照片的重點。',['準備','嘗試','確認'],'用簡短的文字說明這個步驟。','三個步驟'],
    'zh-cn':['作品标题','用简短的文字介绍作品。','作者姓名','第一章','重要的信息','每一页聚焦一个重点，分成简短的段落。\n\n内容较长时，请增加页面，不要缩小文字。','用简短的文字说明照片的重点。',['准备','尝试','确认'],'用简短的文字说明这个步骤。','三个步骤'],
    ar:['عنوان العمل','قدّم فكرتك بكلمات واضحة.','اسم المؤلف','الفصل الأول','فكرة واضحة','ركّز على فكرة واحدة في كل صفحة.\n\nاستخدم فقرات قصيرة وأضف صفحة عند الحاجة.','اشرح الفكرة الأساسية في هذه الصورة.',['استعد','جرّب','تحقق'],'اشرح هذه الخطوة بكلمات واضحة.','ثلاث خطوات'],
    fr:['Votre titre','Présentez votre idée en quelques mots.','Nom de l’auteur','CHAPITRE 1','Une idée claire','Une idée par page.\n\nUtilisez des paragraphes courts et ajoutez une page si nécessaire.','Décrivez ce que montre cette photo.',['Préparer','Essayer','Vérifier'],'Décrivez cette étape en quelques mots.','Trois étapes'],
    de:['Ihr Titel','Stellen Sie Ihre Idee kurz vor.','Name des Autors','KAPITEL 1','Eine klare Idee','Eine Idee pro Seite.\n\nNutzen Sie kurze Absätze und bei Bedarf eine weitere Seite.','Beschreiben Sie das Wesentliche im Bild.',['Vorbereiten','Testen','Prüfen'],'Beschreiben Sie diesen Schritt kurz.','Drei Schritte'],
    es:['Tu título','Presenta tu idea en pocas palabras.','Nombre del autor','CAPÍTULO 1','Una idea clara','Una idea por página.\n\nUsa párrafos cortos y añade otra página si hace falta.','Describe lo importante de esta foto.',['Preparar','Probar','Revisar'],'Describe este paso en pocas palabras.','Tres pasos'],
    pt:['Seu título','Apresente sua ideia em poucas palavras.','Nome do autor','CAPÍTULO 1','Uma ideia clara','Uma ideia por página.\n\nUse parágrafos curtos e adicione outra página se necessário.','Descreva o que importa nesta foto.',['Preparar','Testar','Conferir'],'Descreva este passo em poucas palavras.','Três passos'],
    ko:['작품 제목','작품을 짧게 소개합니다.','작가 이름','제1장','전하고 싶은 이야기','한 페이지에 하나의 주제를 담습니다.\n\n짧은 문단을 사용하고 내용이 길면 페이지를 추가합니다.','사진에서 중요한 내용을 설명합니다.',['준비','시도','확인'],'이 단계를 짧고 구체적으로 설명합니다.','세 단계']
};
export function basicLayoutSamples(language){
    const key=basicLayoutLanguageKey(language),pack=packs[key]||packs.en;
    const [title,intro,author,chapter,heading,body,caption,steps,stepBody,stepsTitle]=pack;
    return {title,intro,author,chapter,heading,body,caption,steps,stepBody,stepsTitle,fallback:!packs[key]};
}
