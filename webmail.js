/* Global variables */
var attempted_auth = false;
var authenticated = false;
var capabilities = [];
var authcapabilities = [];
var ws = null;

var ever_session_connected = false;
var session_connected = false;
var suspendFatalErrors = false;

var checkedNotifyPerm = false;

var folders = null;
var gotlist = false;
var trashFolder = null;
var junkFolder = null;

var viewPreview = true;
var selectedFolder = null;
var pageNumber = 1;
/* Set default page size based on screen size */
var sortOrder = null;
var simpleFilter = null;
var pagesize = window.screen.height > 800 ? 25 : window.screen.height > 600 ? 15 : 10;
var viewRaw = false;
var viewHTML = true;
var allowExternalRequests = false;

var lastMoveTarget = null;
var totalSelected = 0;
var unseenSelected = 0;
var allSelected = false;
var lastNumPages = 0;
var currentUID = 0;
var doingExport = false;

/* For replies */
var lastfrom = null;
var lastreplyto = null;
var lastto = null;
var lastcc = null;
var lastsubject = null;
var lastbody = null;
var lastsent = null;
var lastmsgid = null;
var references = null;

function resetConnection() {
	attempted_auth = false;
	authenticated = false;
	capabilities = [];
	authcapabilities = [];
	ws = null;
}

function disconnect() {
	console.log("Disconnecting...");
	if (ws !== null) {
		ws.close();
		resetConnection();
	}
}

var autoreconnect = null; /* Must be declared for tryAutoReconnect */

function tryAutoReconnect() {
	if (!window.navigator.onLine) {
		console.warn("Client is offline...");
		return;
	}
	console.log("Attempting autoreconnect");
	clearStatus();
	setStatus("Attempting reconnect to server...");
	/* If this fails, then we give up, we don't retry multiple times. */
	tryAutoLogin();
}

function authMethodCompatible(name) {
	if (!authcapabilities.includes(name)) {
		return false; /* If not offered by server, can't possibly use it */
	}
	/* If explicitly requested, or using autoselect, good to use */
	var requested = document.getElementById('authmethod').value;
	return requested === name || requested === "auto";
}

function plainLoginAllowed() {
	var requested = document.getElementById('authmethod').value;
	return requested === "PLAIN" || requested === "auto";
}

function isAutoLogin() {
	var autologin = document.getElementById('autologin');
	return autologin && autologin.value == 1;
}

function tryAutoLogin() {
	var autologout = document.getElementById('autologout');
	if (autologout && autologout.value == 1) {
		console.log("Purging old login data");
		/* This is a bit odd because logout is handled entirely by the client.
		 * The server can invalidate client side sessions only by changing the key (so the JWE can no longer validate when decrypted).
		 * Otherwise, since the expiration in the JWE is fixed, to log out early, the client needs to destroy its cookies (which we trust it will),
		 * and we should also clear the local storage values since they are now useless anyways.
		 * (Cookie values contain non-sensitive server connection info + the encrypted encryption key. Once we lose that, we lose the ability to decrypt the encrypted password. */
		localStorage.removeItem("webmail-iv"); /* Clear IV used for password encryption/decryption */
		localStorage.removeItem("webmail-password"); /* Clear encrypted password */
	}
	if (isAutoLogin() && localStorage.getItem("webmail-password") && localStorage.getItem("webmail-iv")) {
		setStatus("Attempting to login to IMAP server using saved info...");
		console.log("Autoconnecting using saved session info");
		connect();
	}
}

async function tryLogin() {
	if (authcapabilities.includes("LOGINDISABLED")) {
		setFatalError("Login is disabled on this IMAP server");
		return;
	}

	/* Determine how to authenticate */
	var requested = document.getElementById('authmethod').value;

	/* Common IMAP authentication capabilities (hard to find a definitive list):
	 *
	 * Thunderbird-supported: AUTH=LOGIN, AUTH=PLAIN, AUTH=CRAM-MD5, AUTH=NTLM, AUTH=GSSAPI, AUTH=MSN, AUTH=EXTERNAL, AUTH=XOAUTH2
	 * Others: AUTH=DIGEST-MD5, AUTH=OAUTHBEARER
	 *
	 * A somewhat subjective ranking of these capabilities from most secure (and thus most preferred) to least preferred:
	 * Partially based on ordering used here:
	 * - https://github.com/smiley22/S22.Imap/blob/874de537106804fed9cd752b9945c666af6221e2/ImapClient.cs#L305
	 * - https://doc.dovecot.org/configuration_manual/authentication/authentication_mechanisms/
	 *
	 * There are several drawbacks to these schemes, discussed here: https://doc.dovecot.org/configuration_manual/authentication/password_schemes/
	 *
	 * The reason we attempt to support these is the webmail server may be operated by a somewhat trusted
	 * but not entirely trusted intermediary. In particular, we don't want the intermediary to have access
	 * to the plaintext password at any point. Thus, if the IMAP server supports one of these protocols,
	 * it is likely preferrable to use a non-plaintext authentication mechanism to plaintext.
	 * Methods that are largely pertinent to Windows and Active Directory only, e.g. NTLM, GSSAPI (RFC 4752), are omitted here.
	 * XOAUTH2 and its successor, OAUTHBEARER, require being registered with each service, which
	 * makes them less practical to use, since all this needs to be done client-side.
	 *
	 * - OAUTHBEARER (RFC 6750)
	 * - SCRAM-SHA-256 (RFC 7677)
	 * - SCRAM-SHA-1
	 * - DIGEST-MD5
	 * - CRAM-MD5
	 * - PLAIN-CLIENTTOKEN (Gmail-specific, what is this exactly???)
	 * - PLAIN
	 *
	 */

	/* TODO: Add support for all the above. Currently, we just support PLAIN. */

	if (requested === "none") {
		/* Abort, we're connected to the server so can display capabilities */
		setError("Supported IMAP auth methods: " + authcapabilities.join(", "));
		return;
	}

	var pt;
	if (document.getElementById('login-password').value !== "") {
		pt = document.getElementById('login-password').value;
		document.getElementById('login-password').value = ""; /* Clear the plaintext password from the page */
	} else {
		/* Using the encryption key returned by the server, decrypt the password, stored locally */
		var key_base64_encoded = document.getElementById('clientkey');
		if (!key_base64_encoded) {
			console.error("Can't log in (no key available to decrypt password)");
			return;
		}
		key_base64_encoded = key_base64_encoded.value;
		var decoded_key = base64ToArrayBuffer(key_base64_encoded);
		var encoded_pw = localStorage.getItem("webmail-password");
		if (!encoded_pw) {
			console.error("Can't log in (no encrypted password available to decrypt)");
			return;
		}
		var decoded_pw = base64ToArrayBuffer(encoded_pw); /* Get back the ciphertext */

		var encoded_iv = localStorage.getItem("webmail-iv");
		var decoded_iv = base64ToArrayBuffer(encoded_iv); /* Get back the IV */

		pt = await decryptPassword(decoded_pw, decoded_key, decoded_iv); /* Recover the plain text password */
	}

	if (plainLoginAllowed() && (authMethodCompatible("PLAIN") || authMethodCompatible("LOGIN"))) {
		/* All IMAP servers should support AUTH=PLAIN, AUTH=LOGIN, or LOGIN as a last resort */
		var payload = {
			command: "LOGIN",
			/* base64 encode the password purely for obfuscation
			 * Using plaintext password auth is fundamentally not ideal when going through an intermediary web server,
			 * this doesn't improve security at all but at least makes it harder for the server admin to accidentally see the password */
			password: btoa(pt)
		}
		payload = JSON.stringify(payload);
		attempted_auth = true;
		ws.send(payload);
	} else {
		setError("No mutually supported IMAP authentication methods (server supports " + authcapabilities.join(", ") + ")");
	}
}

function enc_encode(m) {
	var encoder = new TextEncoder();
	return encoder.encode(m);
}

function enc_decode(m, encoding) {
	var decoder = new TextDecoder(encoding);
	return decoder.decode(m);
}

async function decryptPassword(ciphertext, raw, iv) {
	var key = await window.crypto.subtle.importKey("raw", raw, "AES-GCM", true, [ "encrypt", "decrypt" ],);
	var decrypted = await window.crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: iv
		},
		key,
		ciphertext
	);
	return enc_decode(decrypted, "utf-8");
}

function arrayBufferToBase64(buffer) {
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa( binary );
}

function base64ToArrayBuffer(base64) {
    var binaryString = atob(base64);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

async function newSession(e, tgt) {
	if (!window.isSecureContext || window.crypto.subtle === undefined) {
		/* By default, this only exists in secure contexts */
		setError("Crypto unavailable in insecure contexts: use HTTPS or enable in your browser e.g. chrome://flags/#unsafely-treat-insecure-origin-as-secure");
		return;
	}

	/* Create a cryptographically secure encryption key
	 * We send this to the server to encrypt and return to us (encrypted by the server) in a JWT.
	 * The server will also bounce the encryption key back in a header.
	 * The point of this is neither the raw encryption key nor the plaintext password is stored on the client.
	 * We need the server to recover these, but the server never has access to the plaintext password,
	 * and it only has access to the plaintext password through this POST request + the JWT cookie,
	 * and it doesn't store that at all. This makes offline attacks more difficult. */

	/* We need to encrypt the password now, BEFORE the form POSTs, or we'll lose access to the password,
	 * since we need to store it, in some form, beforehand. */
	/* Generate an AES-GCM key */
	var aeskey = await window.crypto.subtle.generateKey(
		{
			name: "AES-GCM",
			length: 256,
		},
		true,
		["encrypt", "decrypt"],
	);

	/* Encode and encrypt the plaintext password */
	var encoded = enc_encode(document.getElementById('login-password').value);
	var iv = window.crypto.getRandomValues(new Uint8Array(12)); /* This must never be reused with a given key */
	var ciphertext = await window.crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: iv,
		},
		aeskey,
		encoded
	);
	/* The ciphertext is only ever stored locally. It never leaves the client.
	 * The encryption key goes to the server for safekeeping. It'll encrypt it
	 * and return a scrambled form of it in a JWT, for persistence,
	 * as well as unscrambled in header responses, for immediate usage. */
	var pw_b64_encoded = arrayBufferToBase64(ciphertext);
	localStorage.setItem("webmail-password", pw_b64_encoded); /* Yes, this is encrypted */

	var raw = await window.crypto.subtle.exportKey("raw", aeskey);
	var key_base64_encoded = arrayBufferToBase64(raw);
	document.getElementById('enckey').value = key_base64_encoded; /* Siphon off the key to the server, via the form POST */

	var iv_encoded = arrayBufferToBase64(iv); /* Save the IV locally */
	localStorage.setItem("webmail-iv", iv_encoded);

	const enable_sanity_check = true;
	if (enable_sanity_check) { /* As a sanity check, make sure we get back the original */
		var decoded_key = base64ToArrayBuffer(key_base64_encoded);
		var encoded_pw = localStorage.getItem("webmail-password");
		console.assert(pw_b64_encoded === encoded_pw);
		var decoded_pw = base64ToArrayBuffer(encoded_pw); /* Get back the ciphertext */
		/* console.assert(decoded_pw === ciphertext); */ // Doesn't work since === is just like ptr comparison (but these should be equivalent by value, if compared)
		var pt = await decryptPassword(decoded_pw, decoded_key, iv);
		console.assert(pt === document.getElementById('login-password').value);
		/* Sadly, JS doesn't really allow us to (securely) destroy variables */
	}

	document.getElementById('login-password').value = ""; /* Destroy the password */
	tgt.submit();
}

async function authenticate(e) {
	suspendFatalErrors = false; /* If we previously disconnected, show fatal errors going forward */
	/* If we elected to remember connection info, we need to POST
	 * to the server first (as usual) so we can get the cookie. */
	if (document.getElementById('loginlimit').value > 0) {
		var tgt = e.currentTarget; /* We need to use this after this event handler returns */
		(async () => {
			await newSession(e, tgt);
		})();
		/* Due to the await, we cannot let the form POST as normal,
		 * since the await needs to complete before we can POST it.
		 * So that's done inside initKey() */
		e.preventDefault();
	} else {
		e.preventDefault();
		/* If this is the first login attempt, open the connection */
		if (ws === null) {
			connect(); /* tryLogin() will get invoked eventually */
		} else {
			await tryLogin();
		}
	}
}

document.getElementById('login').addEventListener('submit', function(e) { authenticate(e); }, true);

function connect() {
	var wshost = document.getElementById('websocket-host') ? document.getElementById('websocket-host').value : window.location.host;
	var wshttps = document.getElementById('websocket-https') ? document.getElementById('websocket-https').value == 1 : (window.location.protocol === "https:");
	var wsport = document.getElementById('websocket-port') ? document.getElementById('websocket-port').value : null;
	var wsbaseuri = document.getElementById('websocket-uri') ? document.getElementById('websocket-uri').value : "/webmail";
	var wsuri = ((wshttps ? "wss://" : "ws://") + wshost + (wsport ? (":" + wsport) : "") + wsbaseuri);

	/* We only include query parameters if it's a direct login w/o Remember Me.
	 * However, the cookie might not go to the backend if the hostname is different, so to be safe,
	 * the frontend backend (PHP) also injects all the cookie info into the page, and we set it here.
	 * Since we don't adjust loginlimit for Remember Me autoconnects, we just require loginlimit === 0,
	 * but isAutoLogin() will not necessarily hold.
	 *
	 * XXX Technically, this workaround is only required if the WebSocket hostname differs from our own,
	 * if they're identical, then we can rely on the cookie to transmit this info and then
	 * !isAutoLogin() && document.getElementById('loginlimit').value == 0
	 * might be a better condition.
	 */
	if (document.getElementById('loginlimit').value == 0) {
		/* If logging in directly, need to pass the connection info via the WebSocket URI since that's the only way to pass data prior to connection being established. */
		var server = document.getElementById('server').value;
		wsuri += "?server=" + server;
		var port = document.getElementById('port').value;
		wsuri += "&port=" + port;
		var secure = document.getElementById('security-tls').checked;
		wsuri += "&secure=" + secure;
		/* This is needed for logging in without Remember Me: */
		var username = document.getElementById('login-username').value;
		if (username !== "") {
			wsuri += "&username=" + username;
		}
	}

	console.log("Establishing WebSocket connection to " + wsuri);
	ws = new WebSocket(wsuri);
	console.debug("Established WebSocket connection to " + wsuri);
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

		q = searchParams.get("sort");
		if (q !== undefined && q !== null) {
			var sortDropdown = document.getElementById('option-sort');
			for (var i = 0; i < sortDropdown.options.length; i++) {
				if (sortDropdown.options[i].value === q) {
					sortDropdown.selectedIndex = i;
					sortOrder = i > 0 ? q : null; /* First one is none (default) */
					break;
				}
			}
		}

		q = searchParams.get("filter");
		if (q !== undefined && q !== null) {
			var searchDropdown = document.getElementById('option-filter');
			for (var i = 0; i < searchDropdown.options.length; i++) {
				if (searchDropdown.options[i].value === q) {
					searchDropdown.selectedIndex = i;
					simpleFilter = i > 0 ? q : null; /* First one is none (default) */
					break;
				}
			}
		}

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

		processSettings();
	};
	ws.onmessage = function(e) {
		handleMessage(e);
	}
	ws.onclose = function(e) {
		console.log("Websocket closed");
		if (ever_session_connected) {
			setFatalError("The server closed the connection. Please reload the page.");
		} else {
			setFatalError("The server closed the connection. Please click 'Log in' to reconnect.");
		}
		resetConnection();
		/* If we were able to successfully connect before, give it another shot */
		if (getBoolSetting("autoreconnect") && session_connected) {
			/* Wait a little bit, then retry to see if we can connect */
			console.log("Waiting 25 seconds, then trying to autoreconnect");
			setTimeout(function() {
				tryAutoReconnect();
			}, 25000);
		}
		session_connected = false;
	};
	ws.onerror = function(e) {
		console.log("Websocket error");
		setError("A websocket error occured.");
	};
	console.debug("Set up WebSocket callbacks");
}

function reloadCurrentMessage() {
	if (currentUID > 0) {
		commandFetchMessage(currentUID, true);
	}
}

function setPreviewPaneHeight(height) {
	document.getElementById('previewpane').style.height = height + 'px';
	console.debug("Preview pane height now: " + height);
}

function calculatePreviewPaneHeight() {
	/* Can't get it to work without JS, yuck */ 
	var newheight = document.getElementById('messages').clientHeight - document.getElementById('messagelist').clientHeight;
	if (newheight < 1) {
		newheight = 0;
	}
	if (newheight < 50) {
		setError("Preview pane too small to display. Reduce the page size to increase preview pane height.");
	}
	setPreviewPaneHeight(newheight);
}

function togglePreview(elem) {
	viewPreview = elem.checked;
	document.getElementById("option-preview").checked = viewPreview;
	setq('preview', viewPreview ? "yes" : "no");
	if (!viewPreview) {
		/* Hide it if we don't need it */
		setPreviewPaneHeight(0);
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

function setSort(s) {
	sortOrder = s;
	setq('sort', s);
	/* Do a FETCHLIST again */
	var currentPage = getq('page');
	commandFetchList(currentPage);
}

function setFilter(s) {
	simpleFilter = s;
	setq('filter', s);
	/* Do a FETCHLIST again */
	var currentPage = getq('page');
	commandFetchList(currentPage);
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

function processSettings() {
	/* Settings in local storage, rather than in query params */
	if (getBoolSetting("forcelabels")) {
		document.getElementById('btn-compose').value = "Compose";
		document.getElementById('btn-reply').value = "Reply";
		document.getElementById('btn-replyall').value = "Reply All";
		document.getElementById('btn-forward').value = "Forward";
		document.getElementById('btn-markunread').value = "Mark Unread";
		document.getElementById('btn-markread').value = "Mark Read";
		document.getElementById('btn-flag').value = "Flag";
		document.getElementById('btn-unflag').value = "Unflag";
		document.getElementById('btn-junk').value = "Junk";
		document.getElementById('btn-delete').value = "Delete";
		//document.getElementById('option-extreq').value = "Ext Content";
		//document.getElementById('btn-download').value = "Download";
	}
}

function folderLevel(folder) {
	var level = 0;
	for (var i = 0; i < folder.name.length; i++) {
		if (folder.name.charAt(i) === hierarchyDelimiter) {
			level++;
		}
	}
	return level;
}

function addToFolderMenu(details, searchParams, parent, folder) {
	var li = document.createElement('li');
	li.setAttribute('id', 'folder-link-' + folder.name);
	var selected = searchParams.get("folder") === folder.name;
	if (selected) {
		console.log("Currently selected: " + folder.name);
		li.classList.add("folder-current");
	}

	var dispname = displayFolderName(folder);
	var prefix = folder.prefix;
	var noselect = !folderExists(folder);
	var marked = folder.flags.indexOf("Marked") !== -1;

	if (!details) {
		/* This is just the preliminary list */
		li.innerHTML = "<span class='foldername'>" + prefix + dispname + "</span>";
	} else {
		var extraClasses = (folder.unseen > 0 ? " folder-hasunread" : "") + (marked ? " folder-marked" : "");
		if (noselect) {
			li.innerHTML = "<span class='foldername" + extraClasses + "'>" + prefix + dispname + "<span class='folderunread'>" + "</span>" + "</span>";
		} else {
			/* Since the link has an event listener (commandSelectFolder),
			 * we don't need an actual link for the hyperlink and '#' works just fine as a target.
			 * However, it still shows as a link on the page (as it should), and the hyperlink
			 * value is thus a bit nonsensical, particularly considering that after clicking on it,
			 * the URL will change to reflect that folder.
			 * Additionally, using '#' prevents users from right-clicking and opening a mailbox
			 * in a new tab. So, do set the URL correctly: */
			var currentURL = new URL(window.location.href);
			currentURL.searchParams.set("folder", folder.name); /* Set the folder query param in the link to this folder */
			var linkURL = currentURL.toString();

			li.innerHTML = "<span class='foldername" + extraClasses + "'>" + prefix + "<a href='" + linkURL + "' title='" + folder.name + "'>" + dispname + "<span class='folderunread'>" + (folder.unseen > 0 ? " (" + folder.unseen + ")" : "") + "</span></a>" + "</span>";
			li.innerHTML += ("<span class='foldercount'>" + folder.messages + "</span><span class='foldersize'>" + formatSize(folder.size, 0) + "</span>");
		}
	}
	if (!noselect) {
		/* Allow clicking the entire li to select, since this gives a wider click area */
		li.addEventListener('click', function(e) { commandSelectFolder(folder.name, false); return false; }, {passive: true});
		li.addEventListener('mouseup', function(e) { clickDragMove(folder.name); }, {passive: true});
		li.addEventListener('mouseover', function(e) { folderMouseOver(folder.name, li); }, {passive: true});
		li.addEventListener('mouseleave', function(e) { folderMouseLeave(folder.name, li); }, {passive: true});
		var a = li.getElementsByTagName("a")[0];
		/* However, if somebody does click the link, don't actually follow it.
		 * preventDefault() is needed to prevent clicking a folder from navigating to the link,
		 * since the target is a valid link rather than just '#' */
		a.addEventListener('click', function(e) { e.preventDefault(); }, {passive: false});
	}
	parent.appendChild(li);
}

function checkNotificationPermissions() {
	/* Can only ask for permission in response to a user gesture. This is probably the first click a user will make. */
	checkedNotifyPerm = true;
	console.log("Notification permission: " + Notification.permission);
	/* Also note that in Chrome icognito mode (starting v49), notifications are not allowed.
	 * Can work in insecure origins if configured, otherwise. */
	if (Notification.permission === "denied") {
		console.error("Notification permission denied");
	} else if (Notification.permission !== "granted") {
		console.log("Requesting notification permission");
		Notification.requestPermission();
	}
}

var firstSelection = true;

function commandSelectFolder(folder, autoselected) {
	if (!firstSelection) {
		setq('page', 1); /* Reset to first page of whatever folder was selected */
		pageNumber = 1;
	}
	var payload = {
		command: "SELECT",
		folder: folder,
		page: parseInt(pageNumber), /* If we reload the page, we should resume using whatever page is in the URL */
		pagesize: parseInt(pagesize),
		sort: sortOrder,
		filter: simpleFilter,
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
	if (!autoselected && !checkedNotifyPerm) {
		checkNotificationPermissions();
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
		pagesize: parseInt(pagesize),
		sort: sortOrder,
		filter: simpleFilter,
	}
	console.debug(payload);
	payload = JSON.stringify(payload);
	ws.send(payload);
}

function getSelectedUIDs() {
	if (allSelected) {
		return "1:*";
	}
	var uids = new Array();
	var checkboxes = document.getElementsByName('msg-sel-uid');
	totalSelected = unseenSelected = 0;
	for (var checkbox of checkboxes) {
		if (checkbox.checked) {
			uids.push(parseInt(checkbox.value));
			totalSelected++;
			/* Is it unread?
			 * checkbox is an input. Its parent is a td and its parent is a tr.
			 * If the tr has the class messagelist-unread, it's unseen */
			if (checkbox.parentNode.parentNode.classList.contains("messagelist-unread")) {
				unseenSelected++;
			}
		}
	}
	console.debug(uids);
	return uids;
}

function selectMessage(checkbox) {
	var uid = checkbox.value;
	checkbox.checked = true;
	var tr = document.getElementById('msg-uid-' + checkbox.value);
	if (!tr.classList.contains("messagelist-selected")) {
		tr.classList.add("messagelist-selected");
	}
}

function unselectMessage(checkbox) {
	var uid = checkbox.value;
	checkbox.checked = false;
	var tr = document.getElementById('msg-uid-' + checkbox.value);
	if (tr.classList.contains("messagelist-selected")) {
		tr.classList.remove("messagelist-selected");
	}
}

function selectAllUIDs() {
	var checkboxes = document.getElementsByName('msg-sel-uid');
	for (var checkbox of checkboxes) {
		selectMessage(checkbox);
	}
}

function unselectAllUIDs() {
	/* Reset all checkboxes, and check only this one */
	var checkboxes = document.getElementsByName('msg-sel-uid');
	for (var checkbox of checkboxes) {
		unselectMessage(checkbox);
	}
}

function commandFetchMessage(uid, markSeen) {
	if (!(uid > 0)) {
		console.error("Invalid UID: " + uid);
		return;
	}
	/* Reset all checkboxes, and check only this one */
	var checkboxes = document.getElementsByName('msg-sel-uid');
	for (var checkbox of checkboxes) {
		var selected = parseInt(checkbox.value) === parseInt(uid);
		if (selected) {
			selectMessage(checkbox);
		} else {
			unselectMessage(checkbox);
		}
	}
	console.log("Fetching message " + uid);
	var payload = {
		command: "FETCH",
		uid: parseInt(uid),
		html: viewHTML,
		raw: viewRaw,
		markseen: markSeen /* Needs to be provided explicitly, can't always be inferred (e.g. for viewing raw) */
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
	if (viewRaw) {
		/* If we're downloading the entire message, and it's more than a couple KB,
		 * it could possibly take quite a while, particularly if the client is on
		 * a slow connection (e.g. dial up).
		 * Meanwhile, display a status message to let the user know we're processing the request. */
		setStatus("Downloading raw message, please wait...");
	}
}

function append(data, len) {
	console.log("Appending message with size " + len);
	var payload = {
		command: "APPEND",
		message: data,
		size: len
		/* XXX No date or flags */
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
}

function upload() {
	if (selectedFolder === null) {
		setError("No mailbox currently active");
		return;
	}
	var file = document.getElementById('btn-upload').files[0];
	var size = file.size;
	var data = null;

	var reader = new FileReader();
	reader.onload = (e) => {
		data = e.target.result;
		if (data === null) {
			console.error("No message body?");
		}
		append(data, size);
	};
	reader.readAsText(file);
}

function editor(name, from, to, cc, subject, body, inreplyto, references) {
	/* Escape any quotes inside attributes */
	to = to.replace(/'/g, "&#39;");
	cc = cc.replace(/'/g, "&#39;");
	subject = subject.replace(/'/g, "&#39;");
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
	childhtml += "<textarea id='compose-body' name='body'>" + body + "</textarea>";
	childhtml += "<input type='submit' id='btn-send' name='send' value='Send'/>";
	childhtml += "<input type='submit' name='savedraft' value='Save Draft'/>";
	childhtml += "<h4>Attachment(s)</h4>";
	childhtml += "<input type='file' id='compose-attachments' name='attachments[]' multiple/>";
	childhtml += "</form>";
	childhtml += "</div>";
	childhtml += "</body>";
	childhtml += "<script src='compose.js'></script>";
	childhtml += "</html>";

	var tab = window.open('about:blank', '_blank');
	tab.document.write(childhtml);
	tab.document.close(); /* Finish loading page */
	if (name === "Compose" || name === "Forward") {
		tab.document.getElementById('to').focus(); /* For new messages and forwards, focus the 'To' field since that will generally need to be filled in first */
	} else {
		tab.document.getElementById('compose-body').focus(); /* For replies, we can just focus the body immediately */
	}
}

function compose() {
	/* It isn't actually necessary to initialize 'From' explicitly to document.getElementById('fromaddress').value
	 * (though we do use that as the placeholder).
	 * smtp.php will use the username (which is what fromaddress is) as the default anyways.
	 *
	 * Nonetheless, we do this to make it clearer to the user that this is what will actually be used unless s/he changes it,
	 * it's not just a suggestion. */
	editor("Compose", document.getElementById('fromaddress').value, '', '', '', '', '', '');
}

function doReply(replyto, replycc) {
	if (currentUID < 1) {
		setError("No message is currently selected!");
		return;
	}

	var replysubject = lastsubject.substring(0, 3) === "Re:" ? lastsubject : ("Re: " + lastsubject); /* Don't prepend Re: if it's already there */

	/* Quote each line of the original message */
	/* XXX If we fetched the HTML or message source (raw), we should fetch the plain text component to reply to
	 * XXX Maybe not... for example, Thunderbird-based clients will use the PT or HTML version for replies depending on what was replied to,
	 * so there may be an advantage to allowing the user to choose... */
	var bodyMsg = (lastbody !== undefined ? lastbody.split('\r\n') : "");
	var replybody = "";
	/* Date should never be abbreviated, even if today, we always include the date.
	 * Also, the sender's name should not include the email, if a name is present. */
	replybody += "On " + formatDateNonabbreviated(0, lastsent) + ", " + formatDisplayName(lastfrom) + " wrote:\r\n"
	for (var b in bodyMsg) {
		b = bodyMsg[b];
		replybody += ">" + b + "\r\n";
	}

	/* If one of our configured identities was one of the recipients of the message to which we're replying,
	 * then assume that's us and reply to the message using the same identity.
	 * This mirrors the identity functionality in Thunderbird-like clients. */
	var from = '';
	var idents = getArraySetting('identities');
	for (i = 0; i < idents.length; i++) {
		/* See if any of the identities was any of the recipients of the message to which we're replying. */
		var email = idents[i];
		var tmp = email.indexOf('<');
		if (tmp !== -1) { /* Use just the portion in <>, if specified */
			email = email.substring(tmp + 1);
			tmp = email.indexOf('>');
			email = email.substring(0, tmp);
		}
		if (replyto.indexOf(email) !== -1) {
			from = idents[i]; /* Use the full identity, not just the email portion (on match) */
			console.debug("Overriding from identity to " + from);
			break;
		} else if (replycc.indexOf(email) !== -1) {
			from = idents[i];
			console.debug("Overriding from identity to " + from);
			break;
		}
	}

	/* We use lastmsgid and references to set the In-Reply-To and References headers properly, so we don't break threading
	 * I really hate mail clients that don't preserve threading... their noncompliance makes everyone miserable... */
	editor("Reply", from, replyto, replycc, replysubject, replybody, lastmsgid, lastreferences);
}

function replyHelper(isReplyAll) {
	/* XXX Find the official/standard algorithm for determining to whom to reply and use that (is that even a thing???)
	 *
	 * Convert the array to strings, but if one of the "To" or "Cc" recipients is same as our outgoing From address, or any of our identities, skip it.
	 * Also, in addition to sender, include all the original To recipients, except for ourself, if we are one. */

	var reply_to = "";
	var reply_cc = "";

	if (lastreplyto.length > 0) {
		/* If explicit Reply-To header was present, use that instead of From */
		for (var x in lastreplyto) {
			x = lastreplyto[x];
			/* Don't skip anything in the Reply-To header, use that explicitly */
			reply_to += (reply_to === "" ? "" : ", ") + x;
		}
	} else {
		reply_to = lastfrom; /* Start off by initializing to the sender */
	}

	if (isReplyAll) {
		/* Now, carry over any "To" recipients */
		for (var x in lastto) {
			x = lastto[x];
			/* Even for reply all, if From and To are the same, don't add the address a second time */
			if (x !== reply_to && x.indexOf('"' + document.getElementById('fromaddress').value + '"') === -1) {
				reply_to += ", " + x;
			} else {
				console.debug("Not adding redundant " + x + " to To list");
			}
		}

		/* Finally, do the "Cc" */
		for (var x in lastcc) {
			x = lastcc[x];
			if (x !== reply_to && x.indexOf('"' + document.getElementById('fromaddress').value + '"') === -1) {
				reply_cc += (reply_cc === "" ? "" : ", ") + x;
			} else {
				console.debug("Not adding redundant " + x + " to Cc list");
			}
		}
	}
	doReply(reply_to, reply_cc);
}

function reply(to, cc) {
	replyHelper(false);
}

function replyAll() {
	replyHelper(true);
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

function updateFolderCount(f) {
	setFolderTitle(f.unseen); /* Update page title with new unread count */
	drawFolderMenu(); /* Redraw folder list */
}

function adjustFolderCount(name, difftotal, diffunread) {
	console.log("Applying folder adjustment: " + name + " (" + difftotal + "/" + diffunread + ")");
	var f = getFolder(selectedFolder);
	if (f === null) {
		console.error("Couldn't find current folder (" + selectedFolder.name + ") in folder list?");
	} else {
		f.messages += difftotal;
		f.unseen += diffunread;
		updateFolderCount(f);
	}
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
	if (selected !== "1:*") {
		implicitSeenUnseen(selected, false);
	}
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
	if (selected !== "1:*") {
		implicitSeenUnseen(selected, true);
	}
}

function markFlagged() {
	var selected = getSelectedUIDs();
	if (selected.length < 1) {
		setError("No messages currently selected!");
		return;
	}
	console.log("Mark messages as flagged");
	var payload = {
		command: "FLAG",
		uids: selected
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
}

function markUnflagged() {
	var selected = getSelectedUIDs();
	if (selected.length < 1) {
		setError("No messages currently selected!");
		return;
	}
	console.log("Mark messages as not flagged");
	var payload = {
		command: "UNFLAG",
		uids: selected
	}
	payload = JSON.stringify(payload);
	ws.send(payload);
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

function calculateSpecialFolder(spname) {
	var spfolder = null;
	/* Determine what the right folder is, based on the currently selected mailbox */
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
		if (folders[i].flags.indexOf(spname) != -1) {
			if (spfolder === null) {
				console.debug("Best candidate " + spname + " folder: " + folders[i].name);
			} else {
				console.debug("Better candidate " + spname + " folder: " + folders[i].name);
			}
			spfolder = folders[i].name;
			break;
		} else if (spfolder === null && subname === spname) {
			console.debug("Acceptable candidate " + spname + " folder: " + folders[i].name);
			spfolder = folders[i].name;
			/* Keep trying for a better match */
		}
	}
	if (spfolder === null) {
		console.error("No suitable " + spname + " folder found for this mailbox?");
	}
	return spfolder;
}

function calculateTrashFolder() {
	/* Determine what the right Trash folder is, based on the currently selected mailbox */
	trashFolder = calculateSpecialFolder("Trash");
}

function calculateJunkFolder() {
	junkFolder = calculateSpecialFolder("Junk");
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
		if (getBoolSetting("automarkseen")) {
			/* Thunderbird-based clients implicitly mark messages seen when deleting,
			 * so that unread messages don't show up in the trash. */
			markRead();
		}
		moveTo(trashFolder);
	}
}

function junkMessage() {
	/* Don't actually do an IMAP delete (add Deleted flag and expunge), just move to the Trash folder */
	if (!junkFolder) {
		setError("No junk folder found for current mailbox");
	} else if (junkFolder === selectedFolder) {
		setError("Message already in junk folder");
	} else {
		if (getBoolSetting("automarkseen")) {
			markRead();
		}
		moveTo(junkFolder);
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
	lastMoveTarget = newfolder;
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
	commandFetchMessage(currentUID, false); /* Don't automatically mark seen if just downloading it, may not have viewed it */
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
		if (mailboxNamesEqual(folders[f].name, folder)) {
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
		var changed = false;

		/* The SELECT command response does not return the number of unread messages in the mailbox.
		 * However, the backend will return it so we can update our counts
		 * (it does a STATUS for us behind the scenes to get this information). */
		if (folders[index].messages !== folderinfo.exists) {
			folders[index].messages = folderinfo.exists;
			changed = true;
		}
		if (folders[index].unseen !== folderinfo.unseen) {
			folders[index].unseen = folderinfo.unseen;
			changed = true;
		}
		setFolderTitle(folders[index].unseen);

		/* If the folder was previously Marked, set it to not be Marked anymore, since we just looked at it. */
		var markedindex = folders[index].flags.indexOf("Marked");
		if (markedindex !== -1) {
			folders[index].flags.splice(markedindex, 1); /* Remove this flag */
			changed = true;
		}

		if (changed) {
			drawFolderMenu(); /* Redraw menu if totals changed */
		}
	}

	/* XXX If we do a FETCHLIST (e.g. on IDLE update), these aren't updated (UIDNEXT in particular, for EXISTS) */
	document.getElementById('uidvalidity').textContent = folderinfo.uidvalidity;
	document.getElementById('uidnext').textContent = folderinfo.uidnext + "+";

	/* Determine what the right mailbox to move messages to is for "Delete" and "Junk" operations */
	calculateTrashFolder();
	calculateJunkFolder();
}

/* round = round to 1 decimal point. Default is round to 0 decimal pts */
function formatSize(bytes, round) {
	if (bytes >= 1024) {
		if (bytes > 1048576) {
			var mb = bytes / 1048576;
			if (round) {
				mb = Math.round(mb * 10) / 10; /* Round to 1 decimal pt */
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
	const now = Date.now();

	if (false) {
		/* If we just set the status bar to display a message, don't overwrite it immediately */
		const delay = now - errorMsgSetTime_Actual;
		if (delay < 1500) {
			delay = 1500 - delay;
			console.log("Delaying status notification for " + delay + " ms");
			setTimeout((msg, fatal) => setErrorFull(msg, fatal), delay);
			return;
		}
	}

	/* XXX There isn't a good way of errors to be cleared currently.
	 * User cannot dismiss, and successful actions do not clear errors.
	 * As a workaround, just clear it automatically after a set amount of time,
	 * unless it's a fatal error. */
	document.getElementById('errorbar').textContent = msg;
	errorMsgSetTime_Actual = now;
	if (!fatal) {
		errorMsgSetTime = now; /* epoch in ms */
		setTimeout(() => clearError(), 7000); /* Clear error after 7 seconds, unless a new one has come up */
	} else {
		errorMsgSetTime = now + 999999; /* Make sure the error doesn't disappear */
	}

	if (fatal) {
		/* If notifications are enabled,
		 * notify user that the application has exited. */
		if (canDisplayNotifications() && session_connected) {
			var notification = new Notification("Webmail disconnected", {
				body: "Webmail has closed",
				requireInteraction: false
			});
			notification.onshow = function(event) {
				setTimeout(function () {
					notification.close();
				}, 5000);
			};
			console.debug("Dispatched notification");
		}
	}
}

function clearStatus() {
	document.getElementById('errorbar').textContent = "";
}

function setStatus(msg) {
	document.getElementById('errorbar').textContent = msg;
	errorMsgSetTime = Date.now();
}

function setNotification(msg) {
	setErrorFull(msg, 0);
}

function setFatalError(msg) {
	if (suspendFatalErrors) {
		/* If a fatal error was sent by the backend,
		 * do not override it with a generic failure message about disconnection,
		 * at least until suspendFatalErrors is cleared. */
		return;
	}
	suspendFatalErrors = true;
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
		console.log("Quota usage unavailable for this mailbox");
		return;
	}
	var percent = 0;
	if (total > 0) {
		percent = (100 * used / total).toFixed(1);
		var p = "" + used + "/" + total + " KB (" + percent + "%)";
	} else {
		var p = used + " KB";
	}
	document.getElementById('quota').textContent = p;
	if (percent > 95) {
		document.getElementById('quota').classList.add("quota-warning");
	} else {
		document.getElementById('quota').classList.remove("quota-warning");
	}
}

function formatPT(body) {
	/* pseudo formatting for plain text: bold, italics, underline, and hyperlinks */
	body = escapeHTML(body); /* First, make sure plain text won't get turned into HTML */

	/* Do italics first since / appears in HTML tags (which we'll be adding to the body) */
	/* Require whitespace before match (\s), to avoid matching URLs with a request URI component */
	body = body.replace(/\s\/(\S[^\/]+\S)\//g, " <i>/$1/</i>");
	body = body.replace(/\s\*(\S[^\*]+\S)\*/g, " <b>*$1*</b>");
	body = body.replace(/\s\_(\S[^\_]+\S)\_/g, " <u>_$1_</u>");

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
			var curdepth = quotedepth; /* We start out on the screen where we last were */
			/* There has been a change in the quote depth! It may have been by more than just 1 at a time, too. */
			if (thisquotedepth > quotedepth) {
				/* One (or more) level deeper */
				while (curdepth < thisquotedepth) {
					++curdepth;
					f += "<div class='plaintext-ff-sub plaintext-quote-depth-" + curdepth + "'>";
				}
			} else {
				/* Finalize segments */
				while (curdepth > thisquotedepth) {
					--curdepth;
					f += "</div>";
				}
			}
		} /* else, we append to existing segment */
		f += b;
		quotedepth = thisquotedepth;
	}
	/* Finalize current segment, if any */
	while (quotedepth--) {
		f += "</div>";
	}
	return f;
}

function formatDateFull(epoch, timestamp, abbreviate_today) {
	var epochms = timestamp * 1000;
	var newdate = new Date(epochms); /* Accepts ms since epoch */
	var today = new Date();
	/* If the timestamp is today, don't display date, just the time.
	 * This is what Thunderbird-based clients, etc. do. */
	if (abbreviate_today && newdate.toDateString() === today.toDateString()) { /* It's today */
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

function formatDateAbbreviated(epoch, timestamp) {
	return formatDateFull(epoch, timestamp, 1);
}

function formatDateNonabbreviated(epoch, timestamp) {
	return formatDateFull(epoch, timestamp, 0);
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
	if (email === undefined) {
		return "";
	}
	if (email.length > 23) {
		var arrpos = email.indexOf('<');
		if (arrpos !== -1) {
			/* Include only the name if it's too long, but only if there is a name */
			if (arrpos > 0) {
				email = email.substring(0, arrpos - 1); /* There is a space between name and <, don't include it */
				/* If the name is quoted, strip the quotes. */
				if (email.charAt(0) === '"') {
					email = email.substring(1, email.length - 1);
				}
			} else {
				email = email.substring(1, email.length - 1); /* It's just an email address, in <>. Strip those. */
			}
		}
	}
	return email;
}

function formatDisplayName(addrspec) {
	var arrpos = addrspec.indexOf('<');
	if (arrpos !== -1) {
		if (arrpos > 1) {
			/* Something like name <email>,
			 * we just want to return the name.
			 *
			 * Furthermore, if it's quoteed (e.g. "name" <email>,
			 * we shouldn't include the quotes. */
			addrspec = addrspec.substring(0, arrpos - 1); /* There is a space between name and <, don't include it */
		} else {
			/* <email>, just return email (no <>) */
			return addrspec.substring(arrpos + 1, addrspec.length - 1);
		}
	}
	/* No <>, so it's just an email with no name, return as is */
	/* This is where we filter quotes, if present */
	if (addrspec.charAt(0) === '"') {
		addrspec = addrspec.substring(1, addrspec.length - 2); /* Skip first and last char */
	}
	return addrspec;
}

function listTruncate(text, limit) {
	if (text === undefined) {
		return "";
	}
	if (text.length > limit) {
		text = text.substring(0, limit) + "...";
	}
	return text;
}

function canDisplayNotifications() {
	if (!("Notification" in window)) {
		console.error("Browser does not support notifications");
		return false;
	}
	if (Notification.permission !== "granted") {
		console.error("Can't display notification, permission not granted");
		return false;
	}
	return true;
}

function notifyNewMessageOther(fname) {
	setNotification("You've got mail!");
	if (!canDisplayNotifications()) {
		return;
	}

	var body = "New message in " + fname;
	var notification = new Notification("You've got mail!", {
		body: body,
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
		commandSelectFolder(fname, false); /* Move to this folder if notification is clicked */
	};
	console.debug("Dispatched notification");
}

function notifyNewMessage(msg) {
	setNotification("You've got mail!");
	if (!canDisplayNotifications()) {
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
	console.debug("Dispatched notification");
}

function mailboxNamesEqual(s1, s2) {
	/* In IMAP, mailbox names are case-sensitive...
	 * (even though most server implementations are case-insensitive, we can't assume that) */
	if (s1 === s2) {
		return true;
	}
	/* ... except for INBOX (RFC 3501 5.1)
	 * We do case-insensitive matches for INBOX, as well as any subfolder named "INBOX". */
	var s1_upper = s1.toUpperCase();
	var s2_upper = s2.toUpperCase();
	if (s1_upper == s2_upper) {
		return s1_upper === "INBOX" || s1_upper.endsWith(".INBOX");
	}
	return false;
}

function getFolder(fname) {
	for (var name in folders) {
		if (mailboxNamesEqual(folders[name].name, fname)) {
			return folders[name];
		}
	}
	return null;
}

function folderExistsByName(array, name) {
	for (var i = 0; i < array.length; i++) {
		if (mailboxNamesEqual(array[i].name, name)) {
			return true;
		}
	}
	return false;
}

function createDummyFolders(array) {
	/* A well behaved IMAP server probably shouldn't send orphaned hierarchies, but if the mailbox does not have a parent, append a dummy parent */
	var origlen = array.length;
	for (var i = 0; i < origlen; i++) {
		var fullname = array[i].name;
		var fullParent = ""
		var name = fullname;
		for (;;) {
			var delim = name.indexOf(hierarchyDelimiter);
			if (delim === -1) {
				break;
			}

			var parent = name.substring(0, delim);
			var fullParent = (fullParent.length > 0 ? (fullParent + hierarchyDelimiter) : "") + parent;
			/* See if such a folder exists */
			if (!folderExistsByName(array, fullParent)) {
				console.debug(fullname + " is orphaned, creating parent: " + fullParent);
				var dummy = {
					name: fullParent,
					flags: [ 'NonExistent', 'NoSelect' ],
				};
				array.push(dummy);
			}
			name = name.substring(delim + 1);
		}
	}
}

function moveToFrontByName(array, name) {
	for (i = 0; i < array.length; i++) {
		if (mailboxNamesEqual(array[i].name, name)) {
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

function moveNamespacesToEnd(array) {
	var spliced = 0;
	/* Move Other Users and Shared Folders namespaces to end.
	 * XXX Again we should get the namespace names from the LIST result */
	for (i = 0; i < array.length - spliced; i++) {
		/* Don't include hierarchy delimiter as this applies to the containers themselves */
		if (array[i].name.startsWith("Other Users") || array[i].name.startsWith("Shared Folders")) {
			array.push(array.splice(i, 1)[0]);
			spliced++;
			i--; /* Stay at same index due to splice, or we'll skip one */
		}
	}
}

function displayFolderName(folder) {
	var name = folder.name;
	var prefix = "";

	/* Instead of showing the full name, show a visual hierarchy for subfolders and just the leaf mailbox name */
	for (;;) {
		var delim = name.indexOf(hierarchyDelimiter);
		if (delim === -1) {
			break;
		}
		prefix += "&nbsp;&nbsp;&nbsp;"
		name = name.substring(delim + 1);
	}

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
	folder.prefix = prefix;
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

	var lastAddedFolderLevel = 0;
	var ul = root_ul;
	for (var name in folders) {
		var level = folderLevel(folders[name]);
		if (false) {
			/* WIP: Collapsible subfolder lists: problem is subfolder ul/li's are forced into a single table column,
			 * making the problem worse each nested level
			 * The structure here is right, but the styling is wrong.
			 */
			if (level > lastAddedFolderLevel) {
				var subul = document.createElement('ul');
				ul.appendChild(subul);
				ul = subul;
			} else if (level < lastAddedFolderLevel) {
				ul = ul.parentNode;
			}
		}
		if (!showtotal && folderExists(folders[name]) && folders[name].unseen !== undefined) {
			showtotal = true;
		}
		addToFolderMenu(showtotal, searchParams, ul, folders[name]);
		if (folderExists(folders[name]) && folders[name].unseen !== undefined) {
			totalsize += folders[name].size;
			totalmsg += folders[name].messages;
			totalunread += folders[name].unseen;
		}
		lastAddedFolderLevel = level;
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

var lastCheckedIndex = null;

function selectAllClick(e, obj) {
	console.log(obj.checked);
	/* If the selection checkbox is checked, unselect everything.
	 * The condition here is a bit counterintuitive, since
	 * we want to unselect everything if the checkbox is already checked.
	 * However, I think because this is a passive event, when this checkbox
	 * is unchecked and we check it, this is now true by the time this code executes,
	 * and conversely, if we uncheck it, it is now false by the time we get here.
	 * Thus, to get the previous checkbox state (which is what we want), we
	 * need to invert it. */
	if (!obj.checked) {
		/* Unselect everything */
		unselectAllUIDs();
		allSelected = false;
		obj.checked = false;
	} else {
		selectAllUIDs();
		/* If there's more than one page, clarify what the user wants to do */
		if (lastNumPages > 1 && confirm("Select all messages in this folder?\nOK: Entire folder\nCancel: This page only")) {
			allSelected = true;
		} else {
			allSelected = false;
		}
	}
}

function shiftSelection(index) {
	/* Check all the messages in the range between the two seqnos */
	var a, b;
	/* Starting point and direction depends on direction */
	if (index > lastCheckedIndex) {
		a = lastCheckedIndex
		b = index;
	} else {
		a = index;
		b = lastCheckedIndex;
	}
	var s = lastCheckedIndex;
	console.log("Range selection: " + a + "-" + b);
	a++;
	for (; a < b; a++) {
		var cbox = document.getElementById('msg-sel-index-' + a);
		if (cbox !== undefined && cbox !== null) {
			selectMessage(cbox);
		} else {
			console.error("No message index: " + a);
		}
	}
}

/* Multi-message range selection */
function messageClick(e, obj) {
	var index = parseInt(obj.getAttribute('index'));
	allSelected = false;
	document.getElementById('select-all-cbox').checked = false;
	if (lastCheckedIndex !== null && e.shiftKey) { /* Shift selection */
		shiftSelection(index);
	}
	if (obj.checked) {
		lastCheckedIndex = index;
		selectMessage(obj);
	} else {
		lastCheckedIndex = null;
		unselectMessage(obj);
	}
}

function messageSubjectClick(e, obj) {
	var index = parseInt(obj.parentElement.getAttribute('index'));
	var cbox = document.getElementById('msg-sel-index-' + index);
	allSelected = false;
	document.getElementById('select-all-cbox').checked = false;
	/* If the row for a message is clicked, and a modifier key is held down, select it */
	console.log("last checked index: " + lastCheckedIndex);
	if (lastCheckedIndex !== null && e.shiftKey) { /* Shift selection */
		shiftSelection(index);
		selectMessage(cbox); /* shiftSelection selected everything except the clicked message, so we need this */
	} else if (e.ctrlKey) { /* CTRL */
		/* Add to what's currently selected, without deselecting anything already selected,
		 * unless the clicked message is already selected, then unselect it. */
		if (cbox.checked) {
			unselectMessage(cbox);
		} else {
			selectMessage(cbox);
		}
	} else {
		/* Replace existing selection with just this item */
		unselectAllUIDs();
		allSelected = false;
		obj.checked = false;
		selectMessage(cbox);
	}
	lastCheckedIndex = index;
}

var clickAndDragInProgress = false;

function mouseDownHandler(e, obj) {
	var downTarget = e.target;
	/* Is this one of the subject areas? That's the only place from which it's valid to begin a click'n drag operation. */
	clickAndDragInProgress = e.target.parentElement.hasAttribute('index');
	if (clickAndDragInProgress) {
		e.preventDefault(); /* Prevent default to avoid selecting text on page */
		console.log("Click and drag started");
	}
}

function canClickAndDrag() {
	if (!clickAndDragInProgress) {
		return false;
	}

	/* Is anything selected? */
	var checkboxes = document.getElementsByName('msg-sel-uid');
	for (var checkbox of checkboxes) {
		if (checkbox.checked) {
			return true;
		}
	}
	return false;
}

/* Click and drag to move messages to folder */
function clickDragMove(targetFolder) {
	if (!canClickAndDrag()) {
		return;
	}

	/* A selection is active, move the messages! */
	console.log("Moving selected messages to " + targetFolder);
	moveTo(targetFolder);
}

/* Make it more obvious that an action is in progress */
function folderMouseOver(targetFolder, li) {
	if (!canClickAndDrag()) {
		return;
	}
	if (!li.classList.contains("folder-hover")) {
		li.classList.add("folder-hover");
	}
}

function folderMouseLeave(targetFolder, li) {
	if (!canClickAndDrag()) {
		return;
	}
	if (li.classList.contains("folder-hover")) {
		li.classList.remove("folder-hover");
	}
}

function folderExists(folder) {
	return folder.flags.indexOf("NoSelect") === -1 && folder.flags.indexOf("Noselect") === -1 && folder.flags.indexOf("NonExistent") === -1 && folder.flags.indexOf("Nonexistent") === -1;
}

function addColumnHeading(tr, name) {
	var th = document.createElement('th');
	th.innerHTML = name; /* Can't use textContent, because some of these are escape codes */
	tr.appendChild(th);
}

function handleMessage(e) {
	var jsonData = JSON.parse(e.data);
	console.log(jsonData);
	if (jsonData.response != undefined) {
		var response = jsonData.response;
		if (response === "ERROR") {
			setError(jsonData.msg);
		} else if (response === "status") { /* Message to display in status bar */
			if (jsonData.msg === "") {
				clearStatus();
			} else {
				if (jsonData.error) {
					setFatalError(jsonData.msg);
				} else {
					setStatus(jsonData.msg);
				}
			}
		} else if (response === "CAPABILITY") {
			capabilities = jsonData.capabilities;
			authcapabilities = jsonData.authcapabilities;
			/* We can't check authenticated, since CAPABILITY response to login
			 * is received before the LIST response to it.
			 * To prevent sending a duplicate LOGIN, don't do it more than once. */
			if (!attempted_auth) {
				tryLogin();
			}
		} else if (response === "AUTHENTICATED") {
			authenticated = true; /* If we're getting a LIST response, we must have successfully authenticated */
			session_connected = true;
			ever_session_connected = true;
			document.getElementById('login-container').classList.add('default-hidden');
			document.getElementById('webmail-container').classList.remove('default-hidden');
		} else if (response === "LIST") {
			gotlist = true;
			var moveto = "<option value=''></option>"; /* Start it off with an empty option */

			var allowSelection = false;
			folders = jsonData.data;
			hierarchyDelimiter = jsonData.delimiter;
			if (hierarchyDelimiter === undefined) {
				console.error("Hierarchy delimiter is undefined?");
			}

			createDummyFolders(folders);

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

			moveNamespacesToEnd(folders);

			drawFolderMenu();
			for (var name in folders) {
				/* We'll get a LIST response twice,
				 * the first time with just folder names,
				 * and the second time with all the STATUS details.
				 * Don't issue the SELECT until the second time, to avoid sending it twice. */
				allowSelection = folders[name].unseen !== undefined;
				var dispname = displayFolderName(folders[name]);

				var noselect = !folderExists(folders[name]);
				if (noselect) {
					/* If \NoSelect, don't allow this to be a MOVE/COPY target */
					moveto += "<option value='' disabled>" + folders[name].prefix + dispname + "</option>";
				} else {
					moveto += "<option value='" + folders[name].name + "'>" + folders[name].prefix + dispname + "</option>";
				}
			}

			/* Now that folders are available (on page load), we can try to select the active one */
			if (allowSelection && selectedFolder !== null) {
				commandSelectFolder(selectedFolder, true);
			}

			/* Update move to dropdown with folders */
			document.getElementById('option-moveto').innerHTML = moveto;
		} else if (response === "STATUS") { /* Sent if a NOTIFY command is active */
			/* Update the folder in the folder list, and mark it as "recently updated" */
			var f = getFolder(jsonData.name);
			if (f === null) {
				console.error("Got STATUS message for folder " + jsonData.name);
			} else {
				var setmarked = false;
				/* This STATUS is somewhat incremental: not all of the fields are necessarily available. Update what's provided. */
				if (jsonData.messages !== undefined) {
					f.messages = jsonData.messages;
				}
				if (jsonData.unseen !== undefined) {
					if (jsonData.unseen > f.unseen) {
						setmarked = true; /* New message! */
					}
					f.unseen = jsonData.unseen;
				}
				if (jsonData.size !== undefined) {
					f.size = jsonData.size;
				}
				if (jsonData.recent !== undefined) {
					setmarked &= jsonData.recent;
				}
				if (setmarked) {
					/* Mark it as marked so it'll show up specially, since there's a new message we haven't seen */
					if (f.flags.indexOf("Marked") === -1) {
						f.flags.push("Marked");
					}
					/* If configured to show desktop alert for new messages in other folders, do so */
					notifyNewMessageOther(f.name);
				}
				drawFolderMenu(); /* Redraw folder list */
			}
		} else if (response === "SELECT") {
			/* If we reload, and a particular page was selected, we should retain that.
			 * However, we should reset to 1 whenever we successfully move to a new folder. */
			if (!firstSelection) {
				pageNumber = 1;
			}
			firstSelection = false;
			responseSelectFolder(jsonData);
		} else if (response === "FETCH") {
			if (viewRaw) {
				clearStatus(); /* Get rid of "Downloading, please wait..." status message */
			}
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
			lastreplyto = jsonData.replyto;
			lastto = jsonData.to;
			lastcc = jsonData.cc;
			lastsubject = jsonData.subject;
			/* XXX We should really always be using the plain text body for replies */
			lastbody = jsonData.body;
			lastsent = jsonData.sent;
			lastmsgid = jsonData.messageid;
			lastreferences = jsonData.references !== undefined ? jsonData.references : "";

			if (!viewRaw) {
				msg += "<div id='msg-headers'>";
				msg += "<div class='msg-sent'><span class='hdr-name'>Date</span><span class='hdr-val'>" + formatDateAbbreviated(0, jsonData.sent) + "</span></div>";
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
					if (jsonData.attachments[i].altered !== undefined && jsonData.attachments[i].altered !== false) {
						var detach_tip = jsonData.attachments[i].altered === "detached" ? "Detached" : "Deleted";
						if (jsonData.attachments[i].altered_time) {
							detach_tip += " on " + jsonData.attachments[i].altered_time;
						}
						if (jsonData.attachments[i].detached_location) {
							detach_tip += " to " + jsonData.attachments[i].detached_location;
						}
						msg += "<li class='msg-attachment-detached'>";
						detach_tip = detach_tip.replace(/'/g, "&#39;"); /* Might not be needed, since ' is URL-encoded by Mozilla clients, but shouldn't hurt */
						msg += "<span title='" + detach_tip + "'>";
					} else {
						msg += "<li>";
						msg += "<span>";
					}
					/* Mozilla clients prepend "Deleted: " to the original attachment name for deletions,
					 * but not detachments, so that also allows distinguishing the two without viewing the screen tip. */
					msg += jsonData.attachments[i].name;
					msg += "</span>";
					msg += " (" + formatSize(jsonData.attachments[i].size) + ")</li>";
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
				calculatePreviewPaneHeight();
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
				frame.contentWindow.document.write(body);
				frame.contentWindow.document.close();

				/* Make sure the frame takes up at least the entire space available, since the default height is quite small (150px?)
				 * frame.contentWindow.document.body.scrollHeight will give us the height of the HTML document, but that is NOT what we should set the height to.
				 * Instead, we want to aim for just under the number of pixels actually available for content,
				 * hence subtracting a small number of pixels to avoid overshooting and adding a second scrollbar.
				 * This way, there's just one scrollbar for the HTML content.
				 *
				 * Behavior for HTML messages is slightly different, since scrolling doesn't dismiss the headers (#msg-headers),
				 * while for plaintext, it does, but that's partly due to the structural differences from using an iframe for HTML.
				 */
				if (viewPreview) {
					var frameheight = document.getElementById('messages').clientHeight - document.getElementById('messagelist').clientHeight - document.getElementById('msg-headers').clientHeight;
					frame.style.height = (frameheight - 25) + "px";
				}

				if (!allowExternalRequests) {
					//frame.setAttribute("csp", "default-src 'none'; img-src 'none';"); /* XXX Doesn't have any effect, so use a CSP instead: */

					/* unsafe-inline isn't unsafe here, it's actually exactly what we want.
					 * Load any resources in the content itself, and prohibit making any external requests.
					 * This will prevent tracking, etc. since no external requests can be made,
					 * and it can be a big bandwidth saver too. */
					/* Content-Security-Policy */
					var csp = frame.contentWindow.document.createElement('meta');
					csp.setAttribute('http-equiv', 'Content-Security-Policy');
					csp.setAttribute('content', "default-src 'self'; font-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
					/* Even if there's no head tag in the HTML, the browser will autocreate one */
					frame.contentWindow.document.head.insertBefore(csp, frame.contentWindow.document.head.firstChild);
					/* Even if an adversarial CSP meta tag is included in the message, CSPs are additive,
					 * so it can only be more restrictive than what we've already set:
					 * https://csplite.com/csp67/#multiple_CSP */
				}

				/* If no font specified, use a sans-serif font by default */
				var defaultcss = frame.contentWindow.document.createElement('style');
				defaultcss.innerHTML = "body { font-family: sans-serif; }";
				frame.contentWindow.document.head.insertBefore(defaultcss, frame.contentWindow.document.head.firstChild);

				/* For some reason just stuffing it in the head doesn't work, but this does: */
				var base = frame.contentWindow.document.createElement('base');
				base.setAttribute('target', '_blank');
				frame.contentWindow.document.head.insertBefore(base, frame.contentWindow.document.head.firstChild);
			}

			/* Display the message as seen in the message list */
			implicitSeenUnseen(getSelectedUIDs(), true);
		} else if (response === "RECENT") {
			/* FETCHLIST due to EXISTS will not update folder counts,
			 * since we can do it ourselves.
			 * If an EXPUNGE occurs, then the server will tell us the new counts. */

			/* Note: Just because we got an EXISTS, doesn't mean the message is unseen!
			 * It could be a new message, but it could be a message that somebody copied here for some other reason.
			 * In the latter case, we should really NOT notify the user about this being a "new" message,
			 * and we shouldn't increment the unseen count.
			 *
			 * Since we need the flags to determine if this is new or not,
			 * not sure what a good way to infer this is; for now, we just assume it's new, since that's the common case,
			 * but technically this is wrong. */
			if (jsonData.flags && jsonData.flags.includes("\\Seen")) {
				/* It's a new message, but it's already \Seen.
				 * For example, a \Seen message that was in another folder,
				 * and then moved/copied to this one.
				 * Don't increment the unseen count. */
				adjustFolderCount(selectedFolder, 1, 0);
			} else {
				adjustFolderCount(selectedFolder, 1, 1);
			}
			notifyNewMessage(jsonData);
		} else if (response === "FETCHLIST") {
			/* When loading a page of messages, preview pane is empty so make it 0 height to start.
			 * This avoids it "spilling off the page" if it was previously used and still has old height,
			 * and we increase the # of messages to show per page in FETCHLIST.
			 * The FETCH response handling will set the preview pane height if it is needed.
			 *
			 * However, if a FETCHLIST occured due to an IDLE/NOTIFY update, then we should not
			 * close the preview pane automatically, though we may need to adjust the height in case
			 * the new message list takes up a different amount of space. */
			var idle_refresh = jsonData.cause === "IDLE" || jsonData.cause === "RECENT" || jsonData.cause === "EXISTS" || jsonData.cause === "EXPUNGE";
			if (currentUID > 0 && idle_refresh) {
				/* Don't mess with the preview pane, apart from adjustign the size. */
				/* Just refresh the message list for now. We'll get an RECENT response
				 * in a second that contains the details of the new message for displaying a notification. */
				calculatePreviewPaneHeight();
			} else {
				endMessagePreview(); /* Stop preview of old message */
				setPreviewPaneHeight(0);
			}
			lastCheckedSeqno = null;
			allSelected = false;

			/* First, clear any existing */
			document.getElementById('messagetable').innerHTML = ''; 
			var tr = document.createElement('tr');

			var checkboxtd;
			checkboxtd = document.createElement('td');
			var cinput = document.createElement('input');
			cinput.setAttribute('id', 'select-all-cbox');
			cinput.setAttribute('type', 'checkbox');
			cinput.addEventListener('click', function(e) { selectAllClick(e, this); }, {passive: true});
			checkboxtd.appendChild(cinput);
			tr.appendChild(checkboxtd);

			addColumnHeading(tr, '#');
			addColumnHeading(tr, 'UID &#9660;');
			addColumnHeading(tr, ''); /* Attachments? */
			addColumnHeading(tr, ''); /* Flagged? */
			addColumnHeading(tr, ''); /* Deleted? */
			addColumnHeading(tr, ''); /* Priority? */
			addColumnHeading(tr, ''); /* Answered? */
			addColumnHeading(tr, ''); /* Forwarded? */
			addColumnHeading(tr, 'Subject');
			addColumnHeading(tr, 'From');
			addColumnHeading(tr, 'Recipient');
			addColumnHeading(tr, 'Received');
			addColumnHeading(tr, 'Sent');
			addColumnHeading(tr, 'Size');
			document.getElementById('messagetable').appendChild(tr);

			var w = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
			var maxSubjectLength = 45 + (w > 1000 ? (w > 1500 ? 60 : 30) : 0);

			/* Construct message list table */
			setQuota(jsonData.quota, jsonData.quotaused);
			var epoch = Date.now();
			jsonData.data = Array.prototype.reverse.call(jsonData.data); /* Reverse so it's newest to oldest */
			var index = 1; /* Don't use sequence number, in case there is some other ordering to messages */
			for (var i = 0; i < jsonData.data.length; i++) {
				var tr = document.createElement('tr');
				tr.setAttribute('index', index); /* Same as index attribute for the checkbox input */
				tr.setAttribute('id', 'msg-uid-' + jsonData.data[i].uid);
				var flags = jsonData.data[i].flags;
				if (!flags.includes("\\Seen")) {
					/* Message is unread */
					tr.classList.add("messagelist-unread");
				}
				if (flags.includes("\\Recent")) {
					tr.classList.add("messagelist-recent");
				}
				if (flags.includes("\\Deleted")) {
					tr.classList.add("messagelist-deleted");
				}

				var td;
				td = document.createElement('td');
				var input = document.createElement('input');
				input.setAttribute('id', 'msg-sel-index-' + index);
				input.setAttribute('type', 'checkbox');
				input.setAttribute('name', 'msg-sel-uid');
				input.setAttribute('value', jsonData.data[i].uid);
				input.setAttribute('index', index); /* Dummy attribute to hold index */
				index++;
				input.addEventListener('click', function(e) { messageClick(e, this); }, {passive: true});
				td.appendChild(input);
				tr.appendChild(td);

				td = document.createElement('td');
				td.textContent = jsonData.data[i].seqno;
				tr.appendChild(td);

				var ahref = document.createElement('a');
				var uid = jsonData.data[i].uid;
				ahref.setAttribute('href', '#');
				ahref.setAttribute('title', jsonData.data[i].subject);
				ahref.setAttribute('uid', jsonData.data[i].uid); /* Store UID in a dummy attribute */
				ahref.textContent = jsonData.data[i].uid;
				/* Yes, this is needed, we can't reference this as the arg directly: 8 = length of msg-uid- */
				ahref.addEventListener('click', function() { commandFetchMessage(this.getAttribute("uid"), true); }, {passive: true});
				/* Prevent left-clicking and middle-clicking since these will just reopen the folder, not open the message. */
				ahref.addEventListener('contextmenu', function(e) { e.preventDefault(); setError("Please left-click to open a message"); });
				ahref.addEventListener('auxclick', function(e) { e.preventDefault(); setError("Please left-click to open a message"); });

				td = document.createElement('td');
				td.appendChild(ahref); /* In case subject is empty, also put the link on the UID */
				tr.appendChild(td);

				td = document.createElement('td');
				if (jsonData.data[i].attachments !== undefined && jsonData.data[i].attachments) {
					td.innerHTML = "&#x1F4CE;";
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

				td = document.createElement('td');
				td.innerHTML = flags.includes("\\Answered") ? "<span class='msg-answered'>&larr;</span>" : "";
				tr.appendChild(td);

				td = document.createElement('td');
				td.innerHTML = flags.includes("$Forwarded") ? "<span class='msg-forwarded'>&rarr;</span>" : "";
				tr.appendChild(td);

				ahref = document.createElement('a');
				ahref.setAttribute('href', '#');
				ahref.setAttribute('title', jsonData.data[i].subject);
				ahref.setAttribute('uid', jsonData.data[i].uid); /* Store UID in a dummy attribute */
				ahref.textContent = listTruncate(jsonData.data[i].subject, maxSubjectLength);
				/* Yes, this is needed, we can't reference this as the arg directly: 8 = length of msg-uid- */
				ahref.addEventListener('click', function() { commandFetchMessage(this.getAttribute("uid"), true); }, {passive: true});
				/* Prevent left-clicking and middle-clicking since these will just reopen the folder, not open the message. */
				ahref.addEventListener('contextmenu', function(e) { e.preventDefault(); setError("Please left-click to open a message"); });
				ahref.addEventListener('auxclick', function(e) { e.preventDefault(); setError("Please left-click to open a message"); });

				td = document.createElement('td');
				td.appendChild(ahref);
				tr.appendChild(td);

				/* Add click listener for the subject area, for selection purposes if CTRL or SHIFT are held down */
				td.addEventListener('click', function(e) { messageSubjectClick(e, this); }, {passive: true});

				/* XXX For From/To, add screen tips to show the entire address(es) - will need a subelement, right on the td won't work */

				td = document.createElement('td');
				//td.setAttribute('title', jsonData.data[i].from);
				td.textContent = formatShortEmail(jsonData.data[i].from);
				tr.appendChild(td);

				var reciplist = "";
				for (var j = 0; j < jsonData.data[i].to.length; j++) {
					reciplist += ((j > 0 ? ", " : "") + formatShortEmail(jsonData.data[i].to[j]));
				}

				td = document.createElement('td');
				//td.setAttribute('title', reciplist);
				if (reciplist.length > 30) {
					reciplist = reciplist.substring(0, 30) + "...";
				}
				td.textContent = reciplist;
				tr.appendChild(td);

				var received = formatDateAbbreviated(epoch, jsonData.data[i].received);
				var sent = formatDateAbbreviated(epoch, jsonData.data[i].sent);

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

			/* Update folder counts if needed */
			if (totalSelected > 0 && jsonData.cause === "MOVE") {
				var f = getFolder(selectedFolder);
				var f2 = getFolder(lastMoveTarget);
				/* If the cause was "MOVE", that means we selected some messages and moved them elsewhere.
				 * In this case, we keep track of how many messages were selected, and if we subtract
				 * that here, then that'll probably update this count correctly.
				 * Furthermore, if this is a MOVE, we can add the messages to the move target. */
				f.messages -= totalSelected;
				f2.messages += totalSelected;
				f.unseen -= unseenSelected;
				f2.unseen += unseenSelected;
				totalSelected = unseenSelected = 0;
				updateFolderCount(f);
			} else if (jsonData.unseen !== undefined) {
				/* For certain operations, e.g. EXPUNGE,
				 * the server will tell us how many total/unseen messages remain,
				 * since we have no way of knowing
				 * (and neither did the server, it had to ask for it) */
				var f = getFolder(selectedFolder);
				f.messages = jsonData.messages;
				f.unseen = jsonData.unseen;
				if (jsonData.size !== undefined) {
					/* A gift! The backend told us the current size of the mailbox after whatever just happened. */
					f.size = jsonData.size;
				}
				updateFolderCount(f);
			}

			/* Construct the page list navigation, based on page size and current page */
			var pstr = "<p id='messagepages-p'>";
			pstr += "</p>";
			document.getElementById('messagepages').innerHTML = pstr;
			var pagesparent = document.getElementById('messagepages-p');
			lastNumPages = jsonData.numpages;
			if (jsonData.numpages > 1) {
				/* Pagination required */
				/* We have to do this the clunky way of appending all these children due to the event listeners we need to attach. */

				/* Prev page link */
				var prevPage = pageNumber - 1 < 1 ? 1 : pageNumber - 1;
				var prevOuter = document.createElement('span');
				if (pageNumber > 1) {
					var prevA = document.createElement('a');
					prevA.setAttribute('href', '#');
					prevA.setAttribute('title', 'Page ' + prevPage);
					prevA.addEventListener('click', function() { commandFetchList(prevPage); }, {passive: true});
					prevA.innerHTML = "<< Previous";
					prevOuter.appendChild(prevA);
				} else {
					prevOuter.innerHTML = "<< Previous";
				}
				pagesparent.appendChild(prevOuter);

				/* Direct jump links */
				var i;
				var skip = false;
				/* A jump width of 7 may not seem very high, particularly if you're on the first page, as it typical for viewing the most recent messages.
				 * However, worst cases, there are thousands of pages, and that means the majority of page numbers take up 4 columns.
				 * Additionally, if you are in the middle region, then the jump width is applied on both sides...
				 * e.g. Prev 1 2 3 4 5 6 7 ... 1001 1002 1003 1004 1005 1006 1007 [1008] 1009 1010 1011 1012 1013 1014 1015 ... 2991 2992 2993 2994 2995 2996 2997 Next
				 *
				 * So in the worst case, we have Prev + first 7 + previous 7 + current + next 7 + last 7 + Next = 31 jump page links!
				 * (Worst case # of links = 4 * jumpwidth + 3)
				 *
				 * So, that's why doing more than 7, even on wider monitors, can be problematic. */
				var jumpwidth = document.body.scrollWidth > 1600 ? 7 : 5; /* Adjust this to control how many pages are shown for direct jumping. */
				var numpages = jsonData.numpages;
				for (i = 1; i <= numpages; i++) {
					/* The "skip" var is for when there is a break in consecutive page numbering */
					if (i > jumpwidth && i <= numpages - jumpwidth && Math.abs(pageNumber - i) > jumpwidth) {
						if (skip === false) {
							var x = document.createElement('span');
							x.innerHTML = " | &#133; ";
							pagesparent.appendChild(x);
						}
						skip = true;
						/* To be more efficient, rather than making numpages loop iterations,
						 * which could waste thousands of CPU cycles for no reason,
						 * calculate what the next useful value of i is and set to that.
						 *
						 * (There are 3 intervals, first jumpwidth pages, the jumpwidth pages
						 *  near the current page, and the last jumpwidth pages.). */
						/* i is guaranteed to be > jumpwidth if we are here, so that is not a useful check. */
						var jBefore = pageNumber - jumpwidth - 1; /* Subtract 1 more since the loop post increments i */
						if (i < jBefore) {
							i = jBefore;
						} else {
							/* i > jBefore, so skip right to just before the last J pages. */
							var jAfter = numpages - jumpwidth; /* No need to subtract 1 here, since it's i <= numpages - jumpwidth, not i < numpages - jumpwidth */
							if (i < jAfter) {
								i = jAfter;
							}
						}
						continue; /* Skip pages in the middle, unless they're near the current page */
					}
					skip = false;
					/* Since we have "Previous", add | before first page, too */
					var x = document.createElement('span');
					x.innerHTML = " | ";
					pagesparent.appendChild(x);
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

				/* Since we have "Next" last, add a pipe before that, too */
				var x = document.createElement('span');
				x.innerHTML = " | ";
				pagesparent.appendChild(x);

				/* Next page link */
				var nextPage = pageNumber + 1 > numpages ? numpages : pageNumber + 1;
				var nextOuter = document.createElement('span');
				if (pageNumber < numpages) {
					var nextA = document.createElement('a');
					nextA.setAttribute('href', '#');
					nextA.setAttribute('title', 'Page ' + prevPage);
					nextA.addEventListener('click', function() { commandFetchList(nextPage); }, {passive: true});
					nextA.innerHTML = "Next >>";
					nextOuter.appendChild(nextA);
				} else {
					nextOuter.innerHTML = "Next >>";
				}
				pagesparent.appendChild(nextOuter);
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
document.getElementById('btn-upload').addEventListener('change', upload);

document.getElementById('btn-reply').addEventListener('click', reply);
document.getElementById('btn-replyall').addEventListener('click', replyAll);
document.getElementById('btn-forward').addEventListener('click', forward);
document.getElementById('btn-markunread').addEventListener('click', markUnread);
document.getElementById('btn-markread').addEventListener('click', markRead);
document.getElementById('btn-flag').addEventListener('click', markFlagged);
document.getElementById('btn-unflag').addEventListener('click', markUnflagged);
document.getElementById('btn-junk').addEventListener('click', junkMessage);
document.getElementById('btn-delete').addEventListener('click', deleteMessage);
document.getElementById('btn-expunge').addEventListener('click', expungeFolder);
document.getElementById('btn-move').addEventListener('click', move);
document.getElementById('btn-copy').addEventListener('click', copy);
document.getElementById('btn-download').addEventListener('click', exportMessage);

document.getElementById('option-sort').addEventListener('change', function() { setSort(this.value); }, {passive: true});
document.getElementById('option-filter').addEventListener('change', function() { setFilter(this.value); }, {passive: true});
document.getElementById('option-pagesize').addEventListener('change', function() { setPageSize(this.value); }, {passive: true});
document.getElementById('option-preview').addEventListener('change', function() { togglePreview(this); }, {passive: true});
document.getElementById('option-html').addEventListener('change', function() { toggleHTML(this); }, {passive: true});
document.getElementById('option-extreq').addEventListener('change', function() { toggleExternalRequests(this); }, {passive: true});
document.getElementById('option-raw').addEventListener('change', function() { toggleRaw(this); }, {passive: true});

document.addEventListener('mousedown', function(e) { mouseDownHandler(e, this); }, {passive: false});

/* If we can log in automatically, do so */
tryAutoLogin();
