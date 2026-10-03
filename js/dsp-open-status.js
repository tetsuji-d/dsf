// Do not expose internal sentinel strings in file-opening alerts.
export function dspOpenErrorMessage(error,en=false) {
    if(error?.message==='unsaved')return en?'Save the current manuscript before opening another file.':'別のファイルを開く前に、編集中の原稿を保存してください。';
    if(error?.message==='busy'){
        const messages={
            saving:['DSPファイルを保存中です。保存が終わってから、もう一度開いてください。','A DSP file is being saved. Try opening again when saving finishes.'],
            opening:['作品を読み込み中です。読み込みが終わってから、もう一度開いてください。','A manuscript is loading. Try opening again when loading finishes.'],
            editing:['入力・画像の取り込み・翻訳の処理中です。処理が終わってから、もう一度開いてください。','Text input, image import or translation is in progress. Try opening again when it finishes.'],
            uncommitted:['確定していない入力があります。エディターに戻って入力を確定し、原稿を保存してから開いてください。','There is uncommitted input. Return to the editor, finish the input and save before opening another file.']
        };
        return messages[error.reason]?.[en?1:0]||(en?'The manuscript changed while the file was loading. Check and save the current manuscript, then try again.':'ファイルの読み込み中に原稿の状態が変わりました。編集中の原稿を確認・保存してから、もう一度開いてください。');
    }
    if(error?.message==='not-ready')return en?'Studio is still starting. Try again when it is ready.':'Studioの起動が完了していません。画面の準備ができてから、もう一度開いてください。';
    return en?'Could not open the DSP file. Check the file format and access permission, then try again.':'DSPファイルを開けませんでした。ファイルの形式とアクセス許可を確認し、もう一度お試しください。';
}
