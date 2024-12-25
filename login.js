document.getElementById('loginpreset').addEventListener('change', function() { setPreset(this.value); }, {passive: true});
document.getElementById('security-plain').addEventListener('change', function() { setport('port', 143); }, {passive: true});
document.getElementById('security-tls').addEventListener('change', function() { setport('port', 993); }, {passive: true});
document.getElementById('smtp-security-plain').addEventListener('change', function() { setport('smtpport', 143); }, {passive: true});
document.getElementById('smtp-security-starttls').addEventListener('change', function() { setport('smtpport', 587); }, {passive: true});
document.getElementById('smtp-security-tls').addEventListener('change', function() { setport('smtpport', 465); }, {passive: true});

function setport(name, port) {
	document.getElementById(name).value = port;
}
function autoconfigure(imapserver, imapsecurity, imapport, smtpserver, smtpsecurity, smtpport, append) {
	document.getElementById('server').value = imapserver;
	if (imapsecurity) {
		document.getElementById('security-tls').checked = true;
	} else {
		document.getElementById('security-plain').checked = true;
	}
	setport('port', imapport);
	document.getElementById('smtpserver').value = smtpserver;
	if (smtpsecurity === "starttls") {
		document.getElementById('smtp-security-starttls').checked = true;
	} else if (smtpsecurity === "tls") {
		document.getElementById('smtp-security-tls').checked = true;
	} else {
		document.getElementById('smtp-security-plain').checked = true;
	}
	setport('smtpport', smtpport);
	document.getElementById('append').checked = append;
}
function setPreset(provider) {
	if (provider === "") {
		return;
	}
	var presetdiv = document.getElementsByName('preset-' + provider)[0];
	if (!presetdiv) {
		console.error("No such provider: " + provider);
		return;
	}
	var server = presetdiv.querySelector("input[name='server']").value;
	var security = presetdiv.querySelector("input[name='security']").value == 1;
	var port = presetdiv.querySelector("input[name='port']").value;
	var smtpserver = presetdiv.querySelector("input[name='smtpserver").value;
	var smtpsecurity = presetdiv.querySelector("input[name='smtpsecurity").value;
	var smtpport = presetdiv.querySelector("input[name='smtpport").value;
	var append = presetdiv.querySelector("input[name='append").value;
	/* If we connected to a server to query its capabilities, disconnect from it,
	 * so we can connect to the next server. */
	disconnect();
	autoconfigure(server, security, port, smtpserver, smtpsecurity, smtpport, append);
}

var firstLoad = true;

function selectDefaultPreset() {
	if (!firstLoad || isAutoLogin()) {
		/* If we are logging in with saved credentials, that process have begun already,
		 * since webmail.js is loaded before login.js, i.e. by the time selectDefaultPreset()
		 * is called, a connection could be in progress to try to set up the connection.
		 * So if isAutoLogin() is true, skip, so we don't call disconnect() in setPreset(). */
		return;
	}
	/* Only automatically select preset on first attempt, not successive attempts */
	firstLoad = false;
	var presetcontainer = document.getElementById('loginpreset');
	/* Index 0 corresponds to the empty option (no selection made)
	 * Will be true if $defaultPreset is nonempty in config.php. */
	if (presetcontainer.selectedIndex > 0) {
		console.log("Automatically selecting default preset at index " + presetcontainer.selectedIndex);
		setPreset(presetcontainer.options[presetcontainer.selectedIndex].text);
	}
}

/* RFC 6186 support */
function fetchDNS(prot, domain) {
	var url = "https://dns.google/resolve?name=_" + prot + "._tcp." + domain + "&type=SRV";
	console.log("DNS SRV lookup: " + prot + "._tcp." + domain);
	fetch(url).then(function(res) {
		if (res.ok) {
			res.json().then(function(data) {
				if (data.Answer === undefined) {
					console.error("No SRV records found"); /* But not our fault */
					return;
				}
				var name = data.Answer[0].name;
				var data = data.Answer[0].data;
				if (name === undefined || data === undefined) {
					console.error("SRV answer empty");
					return;
				}
				console.log(data);
				data = data.split(' ');
				if (name.substring(0, 6) === "_imaps") {
					document.getElementById('server').value = data[3];
					document.getElementById('port').value = data[2];
					document.getElementById('security-tls').checked = true;
				} else if (name.substring(0, 11) === "_submission") {
					document.getElementById('smtpserver').value = data[3];
					document.getElementById('smtpport').value = data[2];
					if (data[2] === "587") {
						document.getElementById('smtp-security-starttls').checked = true;
					} else if (data[2] === "465") {
						document.getElementById('smtp-security-tls').checked = true;
					} else {
						/* I dunno, do you? */
					}
				} else {
					console.error("Unexpected: " + name);
				}
			});
		} else {
			console.error("Request failed with code " + res.status);
		}
	});
}

document.getElementById('lookup-btn').addEventListener('click', function() {
	var username = document.getElementById('login-username').value;
	var at = username.indexOf('@');
	if (at === -1) {
		return;
	}
	var domain = username.substring(at + 1);
	fetchDNS("imaps", domain); /* Only look up IMAPS, not IMAP */
	fetchDNS("submission", domain);
});

selectDefaultPreset();
