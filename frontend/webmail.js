var wsuri = (((window.location.protocol === "https:") ? "wss://" : "ws://") + window.location.host + "/webmail");

/* Global variables */
var ws = new WebSocket(wsuri);

var checkedNotifyPerm = false;

var folders = null;
var gotlist = false;
var trashFolder = null;

var viewPreview = true;
var selectedFolder = null;
var pageNumber = 1;
/* Set default page size based on screen size */
console.log("Screen height: " + window.screen.height);
var pagesize = window.screen.height > 800 ? 25 : window.screen.height > 600 ? 15 : 10;
var viewRaw = false;
var viewHTML = true;
var allowExternalRequests = false;

var currentUID = 0;
var doingExport = false;

/* For replies */
var lastfrom = null;
var lastto = null;
var lastcc = null;
var lastsubject = null;
var lastbody = null;
var lastsent = null;
var lastmsgid = null;
var references = null;

function reloadCurrentMessage() {
	if (currentUID > 0) {
		commandFetchMessage(currentUID);
	}
}

function togglePreview(elem) {
	viewPreview = elem.checked;
	document.getElementById("option-preview").checked = viewPreview;
	setq('preview', viewPreview ? "yes" : "no");
	if (!viewPreview) {
		/* Hide it if we don't need it */
		document.getElementById('previewpane').style.height = 0;
	}
	if (viewPreview) {
		reloadCurrentMessage();
	}
}

function toggleHTML(elem) {
	viewHTML = elem.checked;
	document.getElementById("option-html").checked = viewHTML;
	setq('html', viewHTML ? "yes" : "no");
	if (viewPreview) {
		reloadCurrentMessage();
	}
}

function toggleExternalRequests(elem) {
	allowExternalRequests = elem.checked;
	document.getElementById("option-extreq").checked = allowExternalRequests;
	setq('extreq', allowExternalRequests ? "yes" : "no");
	if (viewPreview) {
		reloadCurrentMessage();
	}
}

function toggleRaw(elem) {
	viewRaw = elem.checked;
	document.getElementById("option-raw").checked = viewRaw;
	setq('raw', viewRaw ? "yes" : "no");
	if (viewPreview) {
		reloadCurrentMessage();
	}
}

function setPageSize(pgsz) {
	if (pgsz < 1) {
		return;
	}
	pagesize = pgsz;
	setq('pagesize', pgsz);
	document.getElementById('option-pagesize').selectedIndex = Math.ceil(pagesize / 5) - 1;
	/* Do a FETCHLIST again */
	var currentPage = getq('page');
	commandFetchList(currentPage);
}

ws.onopen = function(e) {
	console.log("Websocket connection opened to " + wsuri);

	/* Load parameters from URL */
	var url = new URL(window.location.href);
	const searchParams = new URLSearchParams(url.search);
	var folder = searchParams.get("folder");
	selectedFolder = folder !== undefined ? folder : "INBOX";
	var q;
	q = searchParams.get("page");
	if (q !== undefined && q !== null) {
		pageNumber = q;
	}
	q = searchParams.get("pagesize");
	if (q !== undefined && q !== null) {
		pagesize = q;
	}
	document.getElementById('option-pagesize').selectedIndex = Math.ceil(pagesize / 5) - 1;

	q = searchParams.get("html");
	if (q !== undefined && q !== null) {
		viewHTML = q === "yes";
	}
	document.getElementById("option-html").checked = viewHTML;

	q = searchParams.get("extreq");
	if (q !== undefined && q !== null) {
		allowExternalRequests = q === "yes";
	}
	document.getElementById("option-extreq").checked = allowExternalRequests;

	q = searchParams.get("raw");
	if (q !== undefined && q !== null) {
		viewRaw = q === "yes";
	}
	document.getElementById("option-raw").checked = viewRaw;

	q = searchParams.get("preview");
	if (q !== undefined && q !== null) {
		viewPreview = q === "yes";
	}
	document.getElementById("option-preview").checked = viewPreview;

	console.log("Folder: " + selectedFolder + ", page: " + pageNumber + ", page size: " + pagesize);
};
ws.onclose = function(e) {
	console.log("Websocket closed");
	if (gotlist) {
		setFatalError("The server closed the connection. Please reload the page.");
	} else {
		setFatalError("The server closed the connection - wrong username or password? Logout and try again.");
	}
};
ws.onerror = function(e) {
	console.log("Websocket error");
	setError("A websocket error occured.");
};

function addToFolderMenu(searchParams, parent, folder) {
	var li = document.createElement('li');
	li.setAttribute('id', 'folder-link-' + folder.name);
	var selected = searchParams.get("folder") === folder.name;
	if (selected) {
		console.log("Currently selected: " + folder.name);
		li.classList.add("folder-current");
	}
	if (folder.unseen === undefined) {
		/* This is just the preliminary list */
		li.innerHTML = "<span class='foldername'><a href='#'>" + displayFolderName(folder) + "</a></span>";
		li.addEventListener('click', function() { commandSelectFolder(folder.name, false); }, {passive: true});
	} else {
		li.innerHTML = "<span class='foldername" + (folder.unseen > 0 ? " folder-hasunread" : "") + "'>" + "<a href='#' title='" + folder.name + "'>" + displayFolderName(folder) + "<span class='folderunread'>" + (folder.unseen > 0 ? " (" + folder.unseen + ")" : "") + "</span></a></span><span class='foldercount'>" + folder.messages + "</span><span class='foldersize'>" + formatSize(folder.size, 0) + "</span>";
		li.addEventListener('click', function() { commandSelectFolder(folder.name, false); }, {passive: true});
	}
	parent.appendChild(li);
}

function commandSelectFolder(folder, autoselected) {
	setq('page', 1); /* Reset to first page of whatever folder was selected */
	var payload = {
		command: "SELECT",
		folder: folder,
		pagesize: parseInt(pagesize)
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
	if (!autoselected && !checkedNotifyPerm) {
		/* Can only ask for permission in response to a user gesture. This is probably the first click a user will make. */
		checkedNotifyPerm = true;
		console.log("Notification permission: " + Notification.permission);
		/* Also note that in Chrome icognito mode (starting v49), notifications are not allowed.
		 * Can work in insecure origins if configured, otherwise. */
		if (Notification.permission !== "granted" && Notification.permission !== 'denied') {
			console.log("Requesting notification permission");
			Notification.requestPermission();
		}
	}
}

function setq(param, value) {
	var url = new URL(window.location.href);
	if (param !== null && value !== null) {
		url.searchParams.set(param, value);
	}
	if (window.history.replaceState) {
		/* Don't store history */
		window.history.replaceState("", document.title, url.toString());
	}
}

function getq(param) {
	var url = new URL(window.location.href);
	const searchParams = new URLSearchParams(url.search);
	return searchParams.get(param);
}

function commandFetchList(page) {
	pageNumber = page;
	setq('page', pageNumber);
	var payload = {
		command: "FETCHLIST",
		page: parseInt(pageNumber),
		pagesize: parseInt(pagesize)
	}
	payload = JSON.stringify(payload);
	console.debug(payload);
	ws.send(payload);
}

function getSelectedUIDs() {
	var uids = new Array();
	var checkboxes = document.getElementsByName('msg-sel-uid');
	for (var checkbox of checkboxes) {
		if (checkbox.checked) {
			uids.push(parseInt(checkbox.value));
		}
	}
	console.debug(uids);
	return uids;
}

function unselectAllUIDs() {
	/* Reset all checkboxes, and check only this one */
	var checkboxes = document.getElementsByName('msg-sel-uid');
	for (var checkbox of checkboxes) {
		checkbox.checked = false;
	}
}

function commandFetchMessage(uid) {
	if (!(uid > 0)) {
		console.error("Invalid UID: " + uid);
		return;
	}
	/* Reset all checkboxes, and check only this one */
	var checkboxes = document.getElementsByName('msg-sel-uid');
	for (var checkbox of checkboxes) {
		checkbox.checked = parseInt(checkbox.value) === parseInt(uid);
	}
	console.log("Fetching message " + uid);
	var payload = {
		command: "FETCH",
		uid: parseInt(uid),
		html: viewHTML,
		raw: viewRaw
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
}

function editor(name, from, to, cc, subject, body, inreplyto, references) {
	var childhtml = "<html><head><title>" + name + "</title><link rel='stylesheet' type='text/css' href='style.css'><link rel='stylesheet' type='text/css' href='form.css'></head><body>";
	childhtml += "<div>";
	childhtml += "<form id='composer' target='' method='post' enctype='multipart/form-data'>";
	childhtml += "<div class='form-table'>";
	childhtml += "<div><label for='from'>From</label><input type='text' id='from' name='from' placeholder='" + document.getElementById('fromaddress').value + "' value='" + from + "'></input></div>";
	childhtml += "<div><label for='replyto'>Reply To</label><input type='text' id='replyto' name='replyto' placeholder='Same as From'></input></div>";
	childhtml += "<div><label for='to'>To</label><input type='text' id='to' name='to' value='" + to + "' required></input></div>";
	childhtml += "<div><label for='cc'>Cc</label><input type='text' id='cc' name='cc' value='" + cc + "'></input></div>";
	childhtml += "<div><label for='bcc'>Bcc</label><input type='text' id='bcc' name='bcc'></input></div>";
	childhtml += "<div><label for='subject'>Subject</label><input type='text' id='subject' name='subject' value='" + subject + "'></input></div>";
	childhtml += "<div><label for='priority'>Priority</label><select name='priority'><option value='1'>Highest</option><option value='2'>High</option><option value='3' selected>Normal</option><option value='4'>Low</option><option value='5'>Lowest</option></select></div>";
	childhtml += "</div>";
	if (inreplyto.length > 0) {
		inreplyto = "<" + inreplyto + ">";
	}
	childhtml += "<input type='hidden' name='inreplyto' value='" + inreplyto + "'>";
	childhtml += "<input type='hidden' name='references' value='" + (references.length > 0 ? (references + "\r\n " + inreplyto) : inreplyto) + "'>";
	childhtml += "<textarea name='body'>" + body + "</textarea>";
	childhtml += "<input type='submit' name='send' value='Send'/>";
	childhtml += "<input type='submit' name='savedraft' value='Save Draft'/>";
	childhtml += "<h4>Attachment(s)</h4>";
	childhtml += "<input type='file' name='attachments[]' multiple/>";
	childhtml += "</form>";
	childhtml += "</div>";
	childhtml += "</body></html>";

	var tab = window.open('about:blank', '_blank');
	tab.document.write(childhtml);
	tab.document.close(); /* Finish loading page */
}

function compose() {
	editor("Compose", '', '', '', '', '', '', '');
}

function doReply(replyto, replycc) {
	if (currentUID < 1) {
		setError("No message is currently selected!");
		return;
	}

	/* XXX Improvement, like Thunderbird et al, if one of our aliases was a To/Cc address,
	 * use that for the From address, rather than our username.
	 * For that, however, the aliases would need to be kept track of somewhere,
	 * and right now this is a (between sessions) stateless program. */
	var replysubject = lastsubject.substring(0, 3) === "Re:" ? lastsubject : ("Re: " + lastsubject); /* Don't prepend Re: if it's already there */

	/* Quote each line of the original message */
	/* XXX If we fetched the message source (raw), we should fetch the plain text component to reply to */
	var bodyMsg = lastbody.split('\r\n');
	var replybody = "";
	/* XXX This is not quite correct - use right format for date + only sender name, if name available */
	replybody += "On " + formatDate(0, lastsent) + ", " + lastfrom + " wrote:\r\n"
	for (var b in bodyMsg) {
		b = bodyMsg[b];
		replybody += ">" + b + "\r\n";
	}

	/* XXX todo use lastmsgid and references to set the In-Reply-To and References headers properly, so we don't break threading! */

	editor("Reply", '', replyto, replycc, replysubject, replybody, lastmsgid, lastreferences);
}

function reply(to, cc) {
	doReply(lastfrom, '');
}

function replyAll() {
	/* Include the Cc.
	 * Also, in addition to sender, include all the original To recipients, except for ourself, if we are one. */
	allfrom = lastfrom;
	var addresses = lastto.split(',');
	for (var x in addresses) {
		x = addresses[x];
		/* XXX Improve this logic: if one of the "To" or "Cc" recipients is same as our outgoing From address, skip it. Should also do for Cc? */
		if (x.indexof('"' + document.getElementById('fromaddress').value + '"') === -1) {
			allfrom += ", " + x;
		} else {
			console.debug("Not adding ourselves to recipient list again");
		}
	}
	doReply(allfrom, lastcc);
}

function forward() {
	var fwdbody = "\r\n\r\n\r\n-------- Forwarded Message --------\r\n";
	fwdbody += "Subject: \t" + lastsubject + "\r\n";
	fwdbody += "Date: \t" + lastsent + "\r\n"; /* XXX Should use the appropriate date format */
	fwdbody += "From:  " + lastfrom + "\r\n";
	fwdbody += "To: \t" + lastto + "\r\n";
	fwdbody += "\r\n\r\n\r\n";
	fwdbody += lastbody;
	editor("Forward", '', '', '', 'Fwd: ' + lastsubject, fwdbody, lastmsgid, lastreferences);
}

function adjustFolderCount(name, difftotal, diffunread) {
	console.log("Applying folder adjustment: " + name + " (" + difftotal + "/" + diffunread + ")");
	for (var f in folders) {
		if (folders[f].name === selectedFolder) {
			var folder = folders[f];
			folder.messages += difftotal;
			folder.unseen += diffunread;
			setFolderTitle(folder.unseen); /* Update page title with new unread count */
			drawFolderMenu(); /* Redraw folder list */
			return;
		}
	}
	console.error("Couldn't find current folder (" + selectedFolder.name + ")in folder list?");
}

function implicitSeenUnseen(selected, markread) {
	/* Mark seen or unseen locally */
	var diffunread = 0;
	for (var uididx in selected) {
		var uid = selected[uididx];
		console.log("Marking message " + (markread ? "read" : "unread") +  " locally: " + uid);
		var tr = document.getElementById('msg-uid-' + uid);
		if (markread) {
			if (tr.classList.contains("messagelist-unread")) {
				/* Only count if this is a change */
				diffunread--;
				tr.classList.remove("messagelist-unread");
			}
		} else {
			if (!tr.classList.contains("messagelist-unread")) {
				/* Only count if this is a change */
				diffunread++;
				tr.classList.add("messagelist-unread");
			}
		}
	}
	if (diffunread !== 0) {
		adjustFolderCount(selectedFolder, 0, diffunread);
	} else {
		console.debug("No actual change in any counts");
	}
}

function markUnread() {
	var selected = getSelectedUIDs();
	if (selected.length < 1) {
		setError("No messages currently selected!");
		return;
	}
	console.log("Mark messages as unseen");
	var payload = {
		command: "UNSEEN",
		uids: selected
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
	implicitSeenUnseen(selected, false);
}

function markRead() {
	var selected = getSelectedUIDs();
	if (selected.length < 1) {
		setError("No messages currently selected!");
		return;
	}
	console.log("Mark messages as seen");
	var payload = {
		command: "SEEN",
		uids: selected
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
	implicitSeenUnseen(selected, true);
}

function markDeleted() {
	var selected = getSelectedUIDs();
	if (selected.length < 1) {
		setError("No messages currently selected!");
		return;
	}
	console.log("Mark messages as deleted");
	var payload = {
		command: "DELETE",
		uids: selected
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
}

function calculateTrashFolder() {
	/* Determine what the right Trash folder is, based on the currently selected mailbox */
	trashFolder = null;
	var requiredPrefix = "";
	var index = 0;
	if (selectedFolder === null) {
		console.error("No source mailbox currently active");
		return;
	}
	/* XXX These namespace names are the most common but should not be hardcoded, but rather returned in the LIST response */
	if (selectedFolder.startsWith("Other Users.")) {
		/* Other Users. = length 12 */
		var secondLevel = selectedFolder.substring(12);
		index = secondLevel.indexOf(hierarchyDelimiter);
		if (index === -1) {
			console.error("Selected folder has unexpected name: " + secondLevel);
			return;
		}
		index += 12;
	} else if (selectedFolder.startsWith("Shared Folders.")) {
		var secondLevel = selectedFolder.substring(14);
		index = secondLevel.indexOf(hierarchyDelimiter);
		if (index === -1) {
			console.error("Selected folder has unexpected name: " + secondLevel);
			return;
		}
		index += 14;
	}
	if (index > 0) {
		index++; /* For the 2nd hierarchy delimiter */
		requiredPrefix = selectedFolder.substring(0, index);
	}
	for (i = 0; i < folders.length; i++) {
		if (index > 0) {
			if (!folders[i].name.startsWith(requiredPrefix)) {
				continue;
			}
		} else {
			if (folders[i].name.startsWith("Other Users.") || folders[i].name.startsWith("Shared Folders.")) {
				/* If it's not in another namespace, then the Trash folder won't be found in another namespace either */
				continue;
			}
		}
		var subname = folders[i].name.substring(index);

		/* Only use the name if we don't have one yet. Otherwise, it has to have the SPECIAL-USE flag.
		 * This supports servers that don't use SPECIAL-USE attributes, but prioritizes those. */
		if (folders[i].flags.indexOf("Trash") != -1) {
			if (trashFolder === null) {
				console.debug("Best candidate trash folder: " + folders[i].name);
			} else {
				console.debug("Better candidate trash folder: " + folders[i].name);
			}
			trashFolder = folders[i].name;
			break;
		} else if (trashFolder === null && subname === "Trash") {
			console.debug("Acceptable candidate trash folder: " + folders[i].name);
			trashFolder = folders[i].name;
			/* Keep trying for a better match */
		}
	}
	if (trashFolder === null) {
		console.error("No suitable trash folder found for this mailbox?");
	}
}

function deleteMessage() {
	/* Don't actually do an IMAP delete (add Deleted flag and expunge), just move to the Trash folder */
	if (!trashFolder) {
		setError("No trash folder found for current mailbox");
	} else if (trashFolder === selectedFolder) {
		/* It's already in the appropriate Trash folder.
		 * Now, set the \Deleted flag on the message, to prepare for the EXPUNGE.
		 * The user can then expunge the mailbox in a separate action.
		 */
		markDeleted();
	} else {
		moveTo(trashFolder);
	}
}

function expungeFolder() {
	if (confirm("WARNING:\nALL messages marked as 'Deleted' will be PERMANENTLY deleted!\nContinue?") !== true) {
		return; /* User cancelled expunge */
	}
	if (selectedFolder === null) {
		setError("No folder currently active!");
		return;
	}
	console.log("Expunding messages in folder " + selectedFolder);
	var payload = {
		command: "EXPUNGE"
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
}

function move() {
	var newfolder = document.getElementById("option-moveto").value;
	if (newfolder.length < 1) {
		setError("No folder is currently selected!");
		return;
	}
	moveTo(newfolder);
}

function copy() {
	var newfolder = document.getElementById("option-moveto").value; /* Uses same dropdown menu */
	if (newfolder.length < 1) {
		setError("No folder is currently selected!");
		return;
	}
	copyTo(newfolder);
	unselectAllUIDs(); /* Don't leave anything checked, or the user will think nothing happened */
}

function moveTo(newfolder) {
	var selected = getSelectedUIDs();
	if (selected.length < 1) {
		setError("No messages currently selected!");
		return;
	}
	console.log("Moving messages to " + newfolder);
	var payload = {
		command: "MOVE",
		uids: selected,
		folder: newfolder
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
}

function copyTo(newfolder) {
	var selected = getSelectedUIDs();
	if (selected.length < 1) {
		setError("No messages currently selected!");
		return;
	}
	console.log("Copying messages to " + newfolder);
	var payload = {
		command: "COPY",
		uids: selected,
		folder: newfolder
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
}

function exportMessage() {
	if (!(currentUID > 0)) {
		setError("No message currently selected");
		return;
	}
	/* XXX Optimization: only redownload if we don't already have the raw source */
	doingExport = true;
	var oldRaw = viewRaw;
	viewRaw = true; /* Get raw source, regardless of current setting */
	commandFetchMessage(currentUID);
	viewRaw = oldRaw; /* Restore */
}

function setFolderTitle(unread) {
	var title = selectedFolder;
	/* If there are unread messages, include that in the webpage title */
	if (unread > 0) {
		title += " (" + unread + ")";
	}
	document.title = title;
	setq(null, null); /* Update URL */
}

function responseSelectFolder(folderinfo) {
	endFolderView();
	var folder = folderinfo.folder;
	// XXX also other stuff in folderinfo to display

	if (folder === undefined) {
		console.error("Folder name is undefined!");
		return;
	}

	/* Remove highlight/focus from current folder and apply it to the new one */
	var current = document.getElementById('folders').getElementsByClassName('folder-current')[0];
	var newfolder = document.getElementById('folder-link-' + folder);
	if (newfolder === undefined || newfolder === null) {
		console.error("Folder not defined? No element with ID folder-link-" + folder);
		return;
	}
	if (current !== undefined && current !== null) {
		current.classList.remove("folder-current");
	} else {
		console.debug("No current folder to unfocus");
	}
	newfolder.classList.add("folder-current");
	console.log("Selecting folder: " + folder);
	setq('folder', folder);
	selectedFolder = folder;
	var title = folder;

	var index = -1;
	for (var f = 0; f < folders.length; f++) {
		if (folders[f].name == folder) {
			index = f;
			break;
		}
	}

	if (index == -1) {
		console.error("Folder undefined: " + folder);
		console.debug("Valid folders: ");
		console.debug(folders);
	} else {
		/* Update counts when we SELECT a mailbox, since we get this info for free */
		/* XXX However, we only get the # of total messages, not # unread, so we can't update that.
		 * Maybe server could silently do a STATUS to get # unread and send us the # unread? */
		if (folders[index].messages !== folderinfo.exists) {
			folders[index].messages = folderinfo.exists;
			drawFolderMenu(); /* Redraw menu if totals changed */
		}
		setFolderTitle(folders[index].unseen);
	}

	/* XXX If we do a FETCHLIST (e.g. on IDLE update), these aren't updated (UIDNEXT in particular, for EXISTS) */
	document.getElementById('uidvalidity').textContent = folderinfo.uidvalidity;
	document.getElementById('uidnext').textContent = folderinfo.uidnext + "+";

	/* Determine what the right mailbox to move messages to is for "Delete" operations */
	calculateTrashFolder();
}

/* round = round to 1 decimal point. Default is round to 0 decimal pts */
function formatSize(bytes, round) {
	if (bytes >= 1024) {
		if (bytes > 1048576) {
			var mb = bytes / 1048576;
			if (round) {
				mb = Math.round(kb * 10) / 10; /* Round to 1 decimal pt */
			} else {
				mb = Math.round(mb);
			}
			return mb + " MB";
		} else {
			var kb = bytes / 1024;
			if (round) {
				kb = Math.round(kb * 10) / 10; /* Round to 1 decimal pt */
			} else {
				kb = Math.round(kb);
			}
			return kb + " KB";
		}
	} else {
		if (bytes === 0) {
			return "";
		}
		return bytes + " B";
	}
}

var errorMsgSetTime = 0;

function clearError() {
	var epoch = Date.now();
	if (epoch > errorMsgSetTime + 6000) {
		/* It's been at least 6 seconds since the last error was displayed. Clear it. */
		document.getElementById('errorbar').textContent = "";
	}
}

function setErrorFull(msg, fatal) {
	/* XXX There isn't a good way of errors to be cleared currently.
	 * User cannot dismissed, and successful actions do not clear errors.
	 * As a workaround, just clear it automatically after a set amount of time,
	 * unless it's a fatal error.
	 */
	document.getElementById('errorbar').textContent = msg;
	if (!fatal) {
		errorMsgSetTime = Date.now(); /* epoch in ms */
		setTimeout(() => clearError(), 7000); /* Clear error after 7 seconds, unless a new one has come up */
	} else {
		errorMsgSetTime = Date.now() + 999999; /* Make sure the error doesn't disappear */
	}
}

function setNotification(msg) {
	setErrorFull(msg, 0);
}

function setFatalError(msg) {
	setErrorFull(msg, 1);
}

function setError(msg) {
	setErrorFull(msg, 0);
}

function endMessagePreview() {
	/* If an old message exists, unhighlight it */
	if (currentUID > 0) {
		var oldmsg = document.getElementById('msg-uid-' + currentUID);
		if (oldmsg !== undefined && oldmsg !== null) {
			oldmsg.classList.remove('message-current');
		} else {
			console.error("Current UID is " + currentUID + ", but unable to deselect it?");
		}
	}
	currentUID = 0; /* Reset current message to nil */
	document.getElementById("previewpane").innerHTML = "";
}

function endFolderView() {
	endMessagePreview(); /* Clear preview pane */
	document.getElementById('messagetable').innerHTML = ""; /* Clear message list table */
	document.getElementById('messagepages').innerHTML = ""; /* Clear page navigation */
}

function setQuota(total, used) {
	if (total === undefined || used === undefined) {
		document.getElementById('quota').textContent = '';
		return;
	}
	var percent = (100 * used / total).toFixed(1);
	var p = "" + used + "/" + total + " KB (" + percent + "%)";
	document.getElementById('quota').textContent = p;
	if (percent > 95) {
		document.getElementById('quota').classList.add("error");
	} else {
		document.getElementById('quota').classList.remove("error");
	}
}

function formatPT(body) {
	/* pseudo formatting for plain text: bold, italics, underline, and hyperlinks */
	body = escapeHTML(body); /* First, make sure plain text won't get turned into HTML */
	/* XXX BUGBUG TODO Don't mess with these when they appear in links or are not the start/end of a word */

	/* Do italics first since / appears in HTML tags (which we'll be adding to the body) */
	body = body.replace(/\/(\S[^\/]+\S)\//g, "<i>$1</i>");
	body = body.replace(/\*(\S[^\*]+\S)\*/g, "<b>$1</b>");
	body = body.replace(/\_(\S[^\_]+\S)\_/g, "<u>$1</u>");

	/* Make links hyperlinks */
	var urlRegex = /(https?:\/\/[^\s]+)/g;
	body = body.replace(urlRegex, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')

	return body;
}

/* RFC 3676: All responsible mail clients must support format=flowed */
/* https://joeclark.org/ffaq.html */
/* https://useplaintext.email/ */
/* https://mailformat.dan.info/body/linelength.html */
function displayFormatFlowed(body, flowed) {
	var bodyMsg = body.split('\r\n');
	var f = "<div class='plaintext-ff'>";
	var quotedepth = 0;
	for (var b in bodyMsg) {
		b = bodyMsg[b];

		var i = 0;
		for (; i < b.length && b.charAt(i) === '>'; i++);
		var thisquotedepth = i;
		/* If line ends in a space, it's flowed, don't add a CR LF at the end.
		 * If it doesn't, that's a hard line break. Add a CR LF so the CSS
		 * will wrap the line. */
		var needCRLF = !flowed || b.charAt(b.length - 1) !== ' ';
		b = b.substr(i); /* Skip the quotes */
		/* Trim any leading whitespace */
		for (i = 0; i < b.length && b.charAt(i) === ' '; i++);
		b = b.substr(i);
		b = formatPT(b);
		if (needCRLF) {
			b += "\r\n";
		}
		if (thisquotedepth != quotedepth) {
			/* There has been a change in the quote depth! */
			if (thisquotedepth > quotedepth) {
				/* One level deeper */
				f += "<div class='plaintext-ff-sub'>" + b;
			} else {
				/* Finalize current segment */
				f += "</div>" + b;
			}
		} else {
			/* Append to existing segment */
			f += b;
		}
		quotedepth = thisquotedepth;
	}
	/* Finalize current segment, if any */
	while (quotedepth--) {
		f += "</div>";
	}
	return f;
}

function formatDate(epoch, timestamp) {
	var epochms = timestamp * 1000;
	var newdate = new Date(epochms); /* Accepts ms since epoch */
	/* If time is within past 24 hours, don't display date, just the time */
	if (epoch && epoch > timestamp && epochms + 86400000 > epoch) { /* Within past 24 hours */
		newdate = newdate.toLocaleTimeString();
	} else {
		newdate = newdate.toLocaleString();
		/* Get rid of comma to save a character, and to match Thunderbird style date display */
		var comma = newdate.indexOf(',');
		if (comma !== undefined) {
			newdate = newdate.substring(0, comma) + newdate.substring(comma + 1);
		}
	}
	return newdate;
}

function escapeHTML(html) {
	var escape = document.createElement('textarea');
	escape.textContent = html;
	return escape.innerHTML;
}

function displayHeader(msg, name, val) {
	if (val !== undefined) {
		msg += "<div><span class='hdr-name'>" + name + "</span><span class='hdr-val'>" + escapeHTML(val) + "</span></div>";
	}
	return msg;
}

function formatShortEmail(email) {
	if (email.length > 23) {
		var arrpos = email.indexOf('<');
		if (arrpos !== -1) {
			email = email.substring(0, arrpos); /* Include only the name if it's too long */
		}
	}
	return email;
}

function listTruncate(text, limit) {
	if (text === undefined) {
		return "";
	}
	if (text.length > limit) {
		text = text.substring(0, limit) + "&#133;";
	}
	return text;
}

function notifyNewMessage(msg) {

	setNotification("You've got mail!");

	if (!("Notification" in window)) {
		console.error("Browser does not support notifications");
		return;
	}

	if (Notification.permission !== "granted") {
		console.error("Can't display notification, permission not granted");
		return;
	}

	var body = "";
	if (msg.subject !== undefined) {
		body += "Subject: " + msg.subject + "\r\n";
	}
	if (msg.from !== undefined) {
		body += "From: " + msg.from;
	}

	var notification = new Notification("You've got mail!", {
		body: body,
		//icon: '/img/logo-person.png',
		requireInteraction: false
	});
	notification.onshow = function(event) {
		setTimeout(function () {
			notification.close();
		}, 5000);
	};
	notification.onclick = function(event) {
		window.focus();
		notification.close();
		/* XXX Also fetch the message if clicked */
	};
}

function moveToFrontByName(array, name) {
	for (i = 0; i < array.length; i++) {
		if (array[i].name === name) {
			array.unshift(array.splice(i, 1)[0]);
		}
	}
}

var hierarchyDelimiter = undefined;

function moveToFrontByFlag(array, flag) {
	for (i = 0; i < array.length; i++) {
		/* XXX Could do within subfolders as well, but for now limit to top-level folders so that it looks right */
		/* If it contains the hierarchy delimiter, skip */
		if (array[i].name.indexOf(hierarchyDelimiter) !== -1) {
			continue;
		}
		if (array[i].flags.indexOf(flag) !== -1) {
			array.unshift(array.splice(i, 1)[0]);
		}
	}
}

function displayFolderName(folder) {
	var name = folder.name;
	if (folder.name.indexOf("INBOX") !== -1) { /* indexOf rather than exact match, so we catch subfolder INBOXes too */
		name = "<span class='folder-icon'>&#128229;</span> " + name;
	} else if (folder.flags.indexOf("Sent") !== -1) {
		name = "<span class='folder-icon'>&#128228;</span> " + name;
	} else if (folder.flags.indexOf("Trash") !== -1) {
		name = "<span class='folder-icon'>&#128465;</span> " + name;
	} else if (folder.flags.indexOf("Junk") !== -1) {
		name = "<span class='folder-icon'>&#128293;</span> " + name;
	} else if (folder.flags.indexOf("Drafts") !== -1) {
		name = "<span class='folder-icon'>&#128240;</span> " + name;
	} else if (folder.flags.indexOf("Archive") !== -1) {
		name = "<span class='folder-icon'>&#128188;</span> " + name;
	} else {
		name = "<span class='folder-icon'>&#x1F5C0;</span> " + name;
	}
	return name;
}

function drawFolderMenu() {
	document.getElementById('folders').innerHTML = ''; /* Delete any old ones */
	var root_ul = document.createElement('ul');
	document.getElementById('folders').appendChild(root_ul);

	console.debug("Drawing or redrawing folder list");

	/* XXX BUGBUG The above still really only works properly for top-level folders:
	 * we also need to move any subfolders (for SPECIAL-USE)
	 * Then again, SPECIAL-USE *typically* don't have any subfolders.
	 * I only noticed this because I moved a folder to Trash,
	 * and it showed up at the bottom, rather than right under Trash.
	 * So not likely to be of much concern to most users... but "fix at some point"
	 */

	var totalsize = 0, totalmsg = 0, totalunread = 0;
	var showtotal = false;

	var total_li = document.createElement('li');
	root_ul.appendChild(total_li);

	var url = new URL(window.location.href);
	const searchParams = new URLSearchParams(url.search);

	for (var name in folders) {
		if (folders[name].flags.indexOf("NoSelect") !== -1) {
			/* If it's not Select'able, why show it? */
			continue;
		}
		addToFolderMenu(searchParams, root_ul, folders[name]);
		if (folders[name].unseen !== undefined) {
			totalsize += folders[name].size;
			totalmsg += folders[name].messages;
			totalunread += folders[name].unseen;
			showtotal = true;
		}
	}
	if (showtotal) {
		total_li.innerHTML = "<span class='foldername'><i>All Folders<span class='folderunread" + (totalunread > 0 ? " folder-hasunread" : "") + "'>" + (totalunread > 0 ? (" (" + totalunread + ")") : "") + "</i></span></a></span><span class='foldercount'>" + totalmsg + "</span><span class='foldersize'>" + formatSize(totalsize) + "</span>";
	} else {
		total_li.innerHTML = "<span class='foldername'><i>Loading&#133;</i></span>";
	}
}

function doDownload(filename, content) {
    var blob = new Blob([content], {type: 'application/octet-stream'});
    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(blob, filename);
    } else{
        var e = document.createEvent('MouseEvents'),
        a = document.createElement('a');
        a.download = filename;
        a.href = window.URL.createObjectURL(blob);
        a.dataset.downloadurl = ['text/plain', a.download, a.href].join(':');
        e.initEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
        a.dispatchEvent(e);
    }
}

ws.onmessage = function(e) {
	var jsonData = JSON.parse(e.data);
	console.log(jsonData);
	if (jsonData.response != undefined) {
		var response = jsonData.response;
		if (response === "ERROR") {
			setError(jsonData.msg);
		} else if (response === "LIST") {
			gotlist = true;
			var moveto = "<option value=''></option>"; /* Start it off with an empty option */

			var allowSelection = false;
			folders = jsonData.data;
			hierarchyDelimiter = jsonData.delimiter;
			if (hierarchyDelimiter === undefined) {
				console.error("Hierarchy delimiter is undefined?");
			}

			/* Sort alphabetically first */
			folders.sort(function(a, b) {
				return a.name.localeCompare(b.name);
			});

			/* In reverse order that we want them to appear */

			/* In case RFC 6154 SPECIAL-USE is not supported by the IMAP server,
			 * manually detect these folder names and order them as such.
			 * If it is supported, this won't do any harm (we'll just redo this, basically)	
			 */
			moveToFrontByName(folders, "Trash");
			moveToFrontByName(folders, "Junk");
			moveToFrontByName(folders, "Archive");
			moveToFrontByName(folders, "Sent");
			moveToFrontByName(folders, "Drafts");
			/* RFC 6154 SPECIAL-USE */
			moveToFrontByFlag(folders, "Trash");
			moveToFrontByFlag(folders, "Junk");
			moveToFrontByFlag(folders, "Sent");
			moveToFrontByFlag(folders, "Drafts");
			/* INBOX at very top */
			moveToFrontByName(folders, "INBOX");

			drawFolderMenu();
			for (var name in folders) {
				if (folders[name].flags.indexOf("NoSelect") !== -1) {
					/* If it's not Select'able, why show it? */
					continue;
				}
				/* We'll get a LIST response twice,
				 * the first time with just folder names,
				 * and the second time with all the STATUS details.
				 * Don't issue the SELECT until the second time, to avoid sending it twice. */
				allowSelection = folders[name].unseen !== undefined;
				moveto += "<option value='" + folders[name].name + "'>" + displayFolderName(folders[name]) + "</option>";
			}

			/* Now that folders are available (on page load), we can try to select the active one */
			if (allowSelection && selectedFolder !== null) {
				commandSelectFolder(selectedFolder, true);
			}

			/* Update move to dropdown with folders */
			document.getElementById('option-moveto').innerHTML = moveto;
		} else if (response === "SELECT") {
			pageNumber = 1; /* Reset to 1 whenever we successfully move to a new folder */
			responseSelectFolder(jsonData);
		} else if (response === "FETCH") {
			if (doingExport) {
				doingExport = false;
				/* Download the message */
				var filename = (lastsubject !== undefined ? lastsubject : jsonData.uid) + ".eml";
				doDownload(filename, jsonData.body);
				return;
			}
			endMessagePreview(); /* Stop preview of old message */

			/* Put message in message preview pane */
			var uid = jsonData.uid;
			var body = jsonData.body;
			currentUID = uid;
			var msg = "";

			lastfrom = jsonData.from;
			lastto = jsonData.to;
			lastcc = jsonData.cc;
			lastsubject = jsonData.subject;
			/* XXX We should really always be using the plain text body for replies */
			lastbody = jsonData.body;
			lastsent = jsonData.sent;
			lastmsgid = jsonData.messageid;
			lastreferences = jsonData.references !== undefined ? jsonData.references : "";

			if (!viewRaw) {
				/* XXX XSS escaping needed for all this, plus HTML body */
				msg += "<div id='msg-headers'>";
				msg += "<div class='msg-sent'><span class='hdr-name'>Date</span><span class='hdr-val'>" + formatDate(0, jsonData.sent) + "</span></div>";
				msg = displayHeader(msg, "From", jsonData.from);
				msg = displayHeader(msg, "Subject", jsonData.subject);
				/* XXX Could be multiple To, Cc, Reply-To, need to iterate over array */
				msg = displayHeader(msg, "Reply to", jsonData.replyto);
				msg = displayHeader(msg, "To", jsonData.to);
				msg = displayHeader(msg, "Cc", jsonData.cc);
				msg = displayHeader(msg, "User-Agent", jsonData.useragent);
				msg += "</div>";
			}

			var htmlframe = false;

			if (!viewRaw && jsonData.contenttype !== undefined && jsonData.contenttype.length > 0 && jsonData.contenttype.indexOf("text/plain") !== -1) {
				if (jsonData.contenttype.indexOf("format=flowed") !== -1) {
					console.debug("Plain text flowed display");
					msg += "<div class='msg-body'>" + displayFormatFlowed(body, 1) + "</div>";
				} else {
					console.debug("Plain text non-flowed display");
					msg += "<div class='msg-body'><div class='plaintext-ff'>" + displayFormatFlowed(body, 0) + "</div></div>";
				}
			} else if (viewHTML && jsonData.contenttype !== undefined && jsonData.contenttype.indexOf("text/html") !== -1) {
				console.debug("HTML display");
				/* Use an iframe to display arbitrary HTML "safely" */
				msg += "<div id='html-body' class='msg-body html-body'></div>";
				htmlframe = true;
			} else {
				/* Fallback to display plain text anyways */
				console.debug("Fallback display");
				msg += "<div class='msg-body'><div class='plaintext-ff'>" + escapeHTML(body) + "</div></div>";
			}
			if (jsonData.attachments.length > 0) {
				msg + "<div class='msg-attachments'>";
				msg += "<hr>";
				msg += "<h4>Attachments</h4>";
				msg += "<ul>";
				for (i = 0; i < jsonData.attachments.length; i++) {
					msg += "<li>" + jsonData.attachments[i].name + " (" + formatSize(jsonData.attachments[i].size) + ")</li>";
				}
				msg += "</ul>";
				msg += "</div>";
			}

			/* Highlight current message */
			var curmsg = document.getElementById('msg-uid-' + uid);
			if (curmsg !== undefined && curmsg !== null) {
				curmsg.classList.add('message-current');
			}

			if (!viewPreview) {
				/* If we're not actually using the preview pane, put it in a new tab */
				var childhtml = "<html><head>";
				childhtml += "<title>" + (jsonData.subject !== undefined ? jsonData.subject : "(no subject)") + "</title>";
				childhtml += "<link rel='stylesheet' type='text/css' href='style.css'><link rel='stylesheet' type='text/css' href='message.css'></head><body>";
				childhtml += (viewRaw || !viewHTML) ? "<div class='plaintext'>" : "<div>";
				childhtml += msg;
				childhtml += "</div>";
				childhtml += "</body></html>";

				var tab = window.open('about:blank', '_blank');
				if (tab !== null) {
					tab.document.write(childhtml);
					tab.document.close(); /* Finish loading page */
				} else {
					console.error("Failed to load new tab?");
				}
			} else {
				/* Set up the preview pane */
				document.getElementById("previewpane").scrollTop = 0; /* Reset scroll to top */
				document.getElementById("previewpane").innerHTML = msg;
				if (viewRaw || viewHTML) {
					/* plain text, or raw */
					document.getElementById("previewpane").classList.add("plaintext");
				} else {
					document.getElementById("previewpane").classList.remove("plaintext");
				}
				/* Can't get it to work without JS, yuck */ 
				var newheight = document.getElementById('messages').clientHeight - document.getElementById('messagelist').clientHeight;
				if (newheight < 1) {
					newheight = 0;
				}
				if (newheight < 50) {
					setError("Preview pane too small to display. Reduce the page size to increase preview pane height.");
				}
				document.getElementById('previewpane').style.height = newheight + 'px';
				console.debug("Preview pane height now: " + newheight);
			}

			if (htmlframe) {
				/* htmlframe.contentWindow will be null until the frame is actually added to the DOM,
				 * which is why we do that first here. */
				if (viewPreview) {
					var frame = document.createElement('iframe');
					document.getElementById('html-body').appendChild(frame);
				} else {
					var frame = tab.document.createElement('iframe');
					tab.document.getElementById('html-body').appendChild(frame);
				}
				frame.setAttribute("sandbox", "");
				frame.contentWindow.document.open('text/html');
				if (!allowExternalRequests) {
					frame.setAttribute("csp", "default-src 'none'; img-src 'none';"); /* XXX Doesn't have any effect, so use a CSP instead: */

					/* unsafe-inline isn't unsafe here, it's actually exactly what we want.
					 * Load any resources in the content itself, and prohibit making any external requests.
					 * This will prevent tracking, etc. since no external requests can be made,
					 * and it can be a big bandwidth saver too. */
					var csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self' 'unsafe-inline';\">";
					/* The meta tag must be inserted inside the head tag or it will be ignored */
					var head = body.indexOf("<head>");
					if (head !== -1) {
						body = body.substring(0, head) + "<head>" + csp + body.substring(head + 6);
					} else {
						body = "<head>" + csp + "</head>" + body;
					}
				}
				frame.contentWindow.document.write(body);
				frame.contentWindow.document.close();
			}

			/* Display the message as seen in the message list */
			implicitSeenUnseen(getSelectedUIDs(), true);
		} else if (response === "EXISTS") {
			notifyNewMessage(jsonData);
			/* XXX Along with IDLE updates, we really want to update the page title with the new unread count!!!!
			 * Currently, the code really only does that on LIST. We need a better mechanism for updating the page title frequently. */
		} else if (response === "FETCHLIST") {
			if (jsonData.cause === "IDLE" || jsonData.cause === "EXISTS" || jsonData.cause === "EXPUNGE") {
				/* Don't mess with the preview pane. */
				/* Just refresh the message list for now. We'll get an EXISTS response
				 * in a second that contains the details of the new message for displaying a notification. */
			} else {
				endMessagePreview(); /* Stop preview of old message */
			}
			document.getElementById('messagetable').innerHTML = '<tr><th></th><th>#</th><th>UID &#9660;</th><th></th><th></th><th></th><th></th><th>Subject</th><th>From</th><th>Recipient</th><th>Received</th><th>Sent</th><th>Size</th></tr>'; /* First, clear any existing */
			/* Construct message list table */
			setQuota(jsonData.quota, jsonData.quotaused);
			var epoch = Date.now();
			jsonData.data = Array.prototype.reverse.call(jsonData.data); /* Reverse so it's newest to oldest */
			for (var i = 0; i < jsonData.data.length; i++) {
				var tr = document.createElement('tr');
				tr.setAttribute('id', 'msg-uid-' + jsonData.data[i].uid);
				//var link = "<a href='#' title='" + escapeHTML(jsonData.data[i].subject) + "'>";
				var flags = jsonData.data[i].flags;
				if (!flags.includes("\\Seen")) {
					/* Message is unread */
					tr.classList.add("messagelist-unread");
				}

				var td;

				td = document.createElement('td');
				td.innerHTML = "<input type='checkbox' name='msg-sel-uid' value='" + jsonData.data[i].uid + "'/>";
				tr.appendChild(td);

				td = document.createElement('td');
				td.textContent = jsonData.data[i].seqno;
				tr.appendChild(td);

				var ahref = document.createElement('a');
				var uid = jsonData.data[i].uid;
				ahref.setAttribute('href', '#');
				ahref.setAttribute('title', escapeHTML(jsonData.data[i].subject));
				ahref.setAttribute('uid', jsonData.data[i].uid); /* Store UID in a dummy attribute */
				ahref.textContent = jsonData.data[i].uid;
				/* Yes, this is needed, we can't reference this as the arg directly: 8 = length of msg-uid- */
				ahref.addEventListener('click', function() { commandFetchMessage(this.getAttribute("uid")); }, {passive: true});
				/* Prevent left-clicking and middle-clicking since these will just reopen the folder, not open the message. */
				ahref.addEventListener('contextmenu', function(e) { e.preventDefault(); setError("Please left-click to open a message"); });
				ahref.addEventListener('auxclick', function(e) { e.preventDefault(); setError("Please left-click to open a message"); });

				td = document.createElement('td');
				td.appendChild(ahref); /* In case subject is empty, also put the link on the UID */
				tr.appendChild(td);

				td = document.createElement('td');
				if (jsonData.data[i].attachments !== undefined) {
					td.innerHTML = jsonData.data[i].attachments.length > 0 ? "&#x1F4CE;" : "";
				}
				tr.appendChild(td);

				td = document.createElement('td');
				td.innerHTML = flags.includes("\\Flagged") ? "&#9873;" : "";
				tr.appendChild(td);

				td = document.createElement('td');
				td.innerHTML = flags.includes("\\Deleted") ? "&#128465;" : "";
				tr.appendChild(td);

				td = document.createElement('td');
				var priority = jsonData.data[i].priority;
				td.innerHTML = (priority > 0 ? priority < 3 ? "<span class='priority-high'>!</span>" : priority > 3 ? "<span class='priority-low'>&darr;</span>" : "" : "")
				tr.appendChild(td);

				ahref = document.createElement('a');
				ahref.setAttribute('href', '#');
				ahref.setAttribute('title', escapeHTML(jsonData.data[i].subject));
				ahref.setAttribute('uid', jsonData.data[i].uid); /* Store UID in a dummy attribute */
				ahref.textContent = listTruncate(escapeHTML(jsonData.data[i].subject, 30));
				/* Yes, this is needed, we can't reference this as the arg directly: 8 = length of msg-uid- */
				ahref.addEventListener('click', function() { commandFetchMessage(this.getAttribute("uid")); }, {passive: true});
				/* Prevent left-clicking and middle-clicking since these will just reopen the folder, not open the message. */
				ahref.addEventListener('contextmenu', function(e) { e.preventDefault(); setError("Please left-click to open a message"); });
				ahref.addEventListener('auxclick', function(e) { e.preventDefault(); setError("Please left-click to open a message"); });

				td = document.createElement('td');
				td.appendChild(ahref);
				tr.appendChild(td);

				/* XXX For From/To, add screen tips to show the entire address(es) - will need a subelement, right on the td won't work */

				td = document.createElement('td');
				//td.setAttribute('title', escapeHTML(jsonData.data[i].from));
				td.textContent = formatShortEmail(jsonData.data[i].from);
				tr.appendChild(td);

				var reciplist = "";
				for (var j = 0; j < jsonData.data[i].to.length; j++) {
					reciplist += ((j > 0 ? ", " : "") + formatShortEmail(jsonData.data[i].to[j]));
				}

				td = document.createElement('td');
				//td.setAttribute('title', escapeHTML(reciplist));
				if (reciplist.length > 30) {
					reciplist = reciplist.substring(0, 30) + "...";
				}
				td.textContent = reciplist;
				tr.appendChild(td);

				var received = formatDate(epoch, jsonData.data[i].received);
				var sent = formatDate(epoch, jsonData.data[i].sent);

				td = document.createElement('td');
				td.textContent = received;
				tr.appendChild(td);
				
				td = document.createElement('td');
				td.textContent = sent;
				tr.appendChild(td);

				td = document.createElement('td');
				td.classList.add('message-size');
				td.textContent = formatSize(jsonData.data[i].size, 1);
				tr.appendChild(td);

				document.getElementById('messagetable').appendChild(tr);
			}

			/* Construct the page list navigation, based on page size and current page */
			var total = folders[jsonData.mailbox] ? folders[jsonData.mailbox].messages : 0;
			if (total === undefined || total === null) {
				console.error("Couldn't find mailbox " + jsonData.mailbox);
			}
			var pstr = "<p id='messagepages-p'>";
			pstr += "</p>";
			document.getElementById('messagepages').innerHTML = pstr;
			var pagesparent = document.getElementById('messagepages-p');
			if (jsonData.numpages > 1) {
				/* Pagination required */
				/* We have to do this the clunky way of appending all these children due to the event listeners we need to attach. */
				var i;
				var skip = false;
				var numpages = jsonData.numpages;
				for (i = 1; i <= numpages; i++) {
					if (i > 5 && i < numpages - 5 && Math.abs(pageNumber - i) > 5) {
						if (skip === false) {
							var x = document.createElement('span');
							x.innerHTML = " | &#133; ";
							pagesparent.appendChild(x);
						}
						skip = true;
						continue; /* Skip pages in the middle, unless they're near the current page */
					}
					skip = false;
					if (i > 1) {
						var x = document.createElement('span');
						x.innerHTML = " | ";
						pagesparent.appendChild(x);
					}
					var outer = document.createElement(i == pageNumber ? 'b' : 'span');
					var a = document.createElement('a');
					a.setAttribute('href', '#');
					a.setAttribute('title', 'Page ' + i);
					/* For some reason, i is always the last page here (inside function()), but this.innerHTML is correct */
					a.addEventListener('click', function() { commandFetchList(this.innerHTML); }, {passive: true});
					a.innerHTML = i;
					outer.appendChild(a);
					pagesparent.appendChild(outer);
				}
			}
		} else {
			console.error("Unknown response type " + response);
		}
	} else {
		console.error("Unsolicited message (no type)");
	}
};

/* Event handlers */
document.getElementById('reload').addEventListener('click', function() { window.location.reload(); });

document.getElementById('btn-compose').addEventListener('click', compose);
document.getElementById('btn-reply').addEventListener('click', reply);
document.getElementById('btn-replyall').addEventListener('click', replyAll);
document.getElementById('btn-forward').addEventListener('click', forward);
document.getElementById('btn-markunread').addEventListener('click', markUnread);
document.getElementById('btn-markread').addEventListener('click', markRead);
document.getElementById('btn-delete').addEventListener('click', deleteMessage);
document.getElementById('btn-expunge').addEventListener('click', expungeFolder);
document.getElementById('btn-move').addEventListener('click', move);
document.getElementById('btn-copy').addEventListener('click', copy);
document.getElementById('btn-download').addEventListener('click', exportMessage);

document.getElementById('option-pagesize').addEventListener('change', function() { setPageSize(this.value); }, {passive: true});
document.getElementById('option-preview').addEventListener('change', function() { togglePreview(this); }, {passive: true});
document.getElementById('option-html').addEventListener('change', function() { toggleHTML(this); }, {passive: true});
document.getElementById('option-extreq').addEventListener('change', function() { toggleExternalRequests(this); }, {passive: true});
document.getElementById('option-raw').addEventListener('change', function() { toggleRaw(this); }, {passive: true});
