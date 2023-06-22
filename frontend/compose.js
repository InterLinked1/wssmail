function sendCheck(e) {
	var body = document.getElementById('compose-body').value;
	if (body.indexOf('attach') !== -1 || body.indexOf('Attach') !== -1) {
		/* Message body includes a word with the prefix attach, did the user forget an attachment? */
		var attachfiles = document.getElementById('compose-attachments').files;
		console.debug(attachfiles.length + " attachment(s) detected");
		if (attachfiles.length === 0) {
			if (confirm("Looks like you might have forgotten an attachment - send anyways?") !== true) {
				e.preventDefault();
				return;
			}
		}
	}
}
document.getElementById('btn-send').addEventListener('click', sendCheck, true);