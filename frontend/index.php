<?php
/*
 * -- wssmail webmail frontend --
 *
 * Copyright (C) 2023, Naveen Albert
 * 
 * This program is free software, distributed under the terms of
 * the GNU General Public License Version 2. See the LICENSE file
 * at the top of the source tree.
 *
 *
 * Usage:
 * - wget https://raw.githubusercontent.com/composer/getcomposer.org/main/web/installer -O - -q | php -- --quiet
 * - php composer.phar require phpmailer/phpmailer
 * - Ensure the PHP imap extension is installed.
 *
 * This frontend depends on a compatible webmail backend (such as mod_webmail in LBBS: https://github.com/InterLinked1/lbbs/)
 * These backends may have different license terms.
 *
 * Configuration is OPTIONAL but NOT REQUIRED. See below.
 *
 * Currently supported (differentiating) features, i.e. atypical of webmail clients and usually only found in standard clients (e.g. Thunderbird)
 * - Extremely fast, compared to traditional webmail clients, since a persistent TCP/IMAP connection are used,
 *   made possible by the use of websockets, rather than using AJAX or full page (re)loads.
 * - Lightweight interface, not bloated, yet designed with power users in mind. Ideal for older browsers and slower connections.
 * - Message listings include sequence numbers, UIDs, and message sizes, to aid in debugging.
 * - Status bar includes UIDVALIDITY and UIDNEXT of selected mailboxes
 * - View total number of messages in and size of each mailbox (folder)
 * - Advanced message operations: copying messages to other mailboxes.
 * - RFC 2177 IMAP IDLE (realtime notifications)
 * - RFC 6186 autoconfiguration
 *
 * Currently supported (standard) features:
 * - Basic message listing: subject, from, recipients, sent/received times, flagged status, attachment status, priority indication
 * - Basic message viewing, in plain text, HTML, or raw source mode
 * - Faithful HTML rendering (Content Security Policy currently prevents this)
 * - Basic message operations (move, mark read/unread, delete, expunge), etc., including on multiple messages at a time
 * - Preview pane or open messages in separate tab
 * - Basic message composition of plain text emails.
 * - Mailbox ordering based on LIST response, including RFC 6154 SPECIAL USE attributes
 * - Draft saving
 * - Set priority of composed messages
 * - Rendering format=flowed plain text messages
 * - Preserving threading in replies
 * - Display current mailbox quota usage
 * - Attaching attachments
 * - Save copies of sent messages to Sent folder (via IMAP APPEND)
 * - Content Security Policy to mitigate CSS and JS injection in modern browsers
 * - Control whether HTML emails are allowed to load remote content
 *
 * Very nearly supported:
 * - Sending format=flowed plain text messages
 *
 * Known issues:
 * - Folder list details and title do not update with new/expunged messages (+marked as unread)
 * - Stay logged in "forever" does not work properly
 *
 * Not currently supported, but would be nice to have (future roadmap):
 * - Downloading/detaching/deleting attachments.
 * - Resuming or sending email drafts
 * - Displaying messages grouped in threads
 * - Sorting, by date, and other attributes
 * - Update message list table when server implicitly marks messages as read
 * - Updating list of folders with updated counts/sizes as needed
 * - Searching, filtering (e.g. show only unread messages in a folder)
 * - Message flags/tags: adding, viewing, and removing
 * - Built-in ManageSieve client for managing Sieve filters: https://github.com/ProtonMail/libsieve-php
 * - BURL IMAP/SMTP
 *
 * Not supported, not currently planned (not on the roadmap):
 * - Composition of HTML messages (HTML message editor)
 */

/* SMTP */
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require('vendor/autoload.php');

if (file_exists('config.php')) {
	require_once('config.php');
}

if (!extension_loaded('imap')) {
	fprintf(STDERR, "PHP imap extension is not available. Please install it!");
	die();
} else if (!extension_loaded('openssl')) {
	fprintf(STDERR, "PHP openssl extension is not available. Please install it!");
	die();
}

function logout() {
	$_SESSION = array();
	if (ini_get("session.use_cookies")) {
		$params = session_get_cookie_params();
		setcookie(session_name(), '', time() - 42000,
			$params["path"], $params["domain"],
			$params["secure"], $params["httponly"]
		);
	}
	session_unset();
	session_destroy();
}

session_start();
if (isset($_SESSION['webmail'])) {
	/* Idle too long since last active? */
	if (isset($_POST['logout']) || $_SESSION['webmail']['loginlimit'] > 0) {
		$lastActive = $_SESSION['webmail']['active'];
		if (isset($_POST['logout']) || $lastActive < time() - 7200) {
			/* Auto logout */
			logout();
			/* Reload the page now */
			header("Location:" . $_SERVER['REQUEST_URI']);
			die();
		}
	}
}

function startHTML() {
	?><!DOCTYPE html>
<html>
<head>
	<title>Webmail</title>
	<link rel="stylesheet" type="text/css" href="style.css">
	<link rel="stylesheet" type="text/css" href="main.css">
	<link rel="stylesheet" type="text/css" href="form.css">
	<link rel="stylesheet" type="text/css" href="message.css">
</head>
<body>
	<?php
}

if (!isset($_SESSION['webmail'])) {
	$error = null;
	/* Login page */
	if (isset($_POST['server'], $_POST['port'], $_POST['smtpserver'], $_POST['smtpport'], $_POST['username'], $_POST['password'], $_POST['security'], $_POST['smtpsecurity'], $_POST['loginlimit'], $_POST['append'])) {
		/* Login submission */
		if (!strlen($_POST['server']) || !strlen($_POST['smtpserver']) || !strlen($_POST['username'])) {
			$error = "Missing required info";
		} else {
			$_SESSION['webmail']['server'] = isset($settings['login']['imap']['server']) ? $settings['login']['imap']['server'] : $_POST['server'];
			$_SESSION['webmail']['port'] = (int) (isset($settings['login']['imap']['port']) ? $settings['login']['imap']['port'] : $_POST['port']);
			$_SESSION['webmail']['secure'] = (isset($settings['login']['imap']['security']) ? $settings['login']['imap']['security'] : $_POST['security']) === "tls";
			$_SESSION['webmail']['smtpserver'] = isset($settings['login']['smtp']['server']) ? $settings['login']['smtp']['server'] : $_POST['smtpserver'];
			$_SESSION['webmail']['smtpport'] = (int) (isset($settings['login']['smtp']['port']) ? $settings['login']['smtp']['port'] : $_POST['smtpport']);
			$_SESSION['webmail']['smtpsecure'] = (isset($settings['login']['smtp']['security']) ? $settings['login']['smtp']['security'] : $_POST['smtpsecurity']);
			$_SESSION['webmail']['username'] = $_POST['username'];
			$_SESSION['webmail']['password'] = $_POST['password'];
			$_SESSION['webmail']['loginlimit'] = (int) $_POST['loginlimit'];
			$_SESSION['webmail']['append'] = isset($settings['login']['imap']['append']) ? $settings['login']['imap']['append'] : $_POST['append'] === "append"; /* Whether to upload sent messages to IMAP server */

			$_SESSION['webmail']['active'] = time();
			/* Reload the page now */
			header("Location:" . $_SERVER['REQUEST_URI']);
			die();
		}
	}
	startHTML();
	?>
	<div id="login-container">
		<form id="login" target="" method="post">
			<p class='error'><?php echo !is_null($error) ? $error : "";?></p>
			<div class='form-table'>
				<?php /* XXX Improvement: allow presetting settings via GET parameters and prefill them in here? Or maybe presets are good enough? */ ?>
				<?php
				if (!isset($settings['login']['imap']['server'])) {
				?>
					<div>
						<label for="loginpreset">Provider Preset</label>
						<select name="loginpreset" id="loginpreset" onchange="setPreset(this.value)">
							<option value=""></option>
							<?php
							if (isset($settings['presets'])) {
								foreach ($settings['presets'] as $preset) {
									echo "<option value='" . $preset['name'] . "'>" . $preset['name'] . "</option>";
								}
							}
							?>
							<option value="Office365">Office365 (Outlook.com)</option>
							<option value="Gmail">Gmail</option>
							<option value="Yahoo">Yahoo</option>
							<option value="iCloud">iCloud</option>
							<option value="Yandex">Yandex</option>
							<option value="PurelyMail">PurelyMail</option>
							<option value="Riseup">Riseup</option>
						</select>
					</div>
				<?php
				}
				if (!isset($settings['login']['imap']['server'])) {
				?>
					<div>
						<label for="server">IMAP Server</label><input type="text" id="server" name="server" value="localhost"/>
					</div>
				<?php
				}
				if (!isset($settings['login']['imap']['security'])) {
				?>
					<div>
						<label>IMAP Security</label>
						<div>
							<input type="radio" id="security-plain" name="security" value="none" checked onchange="setport('port', 143)" />
							<label for="security-plain">None</label>
							<input type="radio" id="security-tls" name="security" value="tls" onchange="setport('port', 993)" />
							<label for="security-tls">TLS</label>
						</div>
					</div>
				<?php
				}
				if (!isset($settings['login']['imap']['port'])) {
				?>
					<div>
						<label for="port">IMAP Port</label><input type="number" id="port" name="port" value="143"/>
					</div>
				<?php
				}
				if (!isset($settings['login']['smtp']['server'])) {
				?>
					<div>
						<label for="smtpserver">SMTP Server</label><input type="text" id="smtpserver" name="smtpserver" value="localhost"/>
					</div>
				<?php
				}
				if (!isset($settings['login']['smtp']['security'])) {
				?>
					<div>
						<label>SMTP Security</label>
						<div>
							<input type="radio" id="smtp-security-plain" name="smtpsecurity" value="none" checked onchange="setport('smtpport', 143)" />
							<label for="smtp-security-plain">None</label>
							<input type="radio" id="smtp-security-starttls" name="smtpsecurity" value="starttls" onchange="setport('smtpport', 587)" />
							<label for="smtp-security-starttls">STARTTLS</label>
							<input type="radio" id="smtp-security-tls" name="smtpsecurity" value="tls" onchange="setport('smtpport', 465)" />
							<label for="smtp-security-tls">TLS</label>
						</div>
					</div>
				<?php
				}
				if (!isset($settings['login']['smtp']['port'])) {
				?>
					<div>
						<label for="port">SMTP Port</label><input type="number" id="smtpport" name="smtpport" value="25"/>
					</div>
				<?php
				}
				?>
				<div>
					<label for="username">Username</label><input type="text" id="login-username" name="username" autocomplete="username" value=""/>
				</div>
				<div>
					<label for="password">Password</label><input type="password" name="password" autocomplete="current-password" value=""/>
				</div>

				<div>
					<label for="loginlimit">Time to stay logged in</label>
					<select name="loginlimit" id="loginlimit">
						<option value="0">Forever</option>
						<option value="1800">Half an hour</option>
						<option value="3600">1 hour</option>
						<option value="7200">2 hours</option>
						<option value="86400">1 day</option>
						<option value="604800">1 week</option>
						<option value="2592000">1 month</option>
					</select>
				</div>
			</div>
			<?php
			if (!isset($settings['login']['imap']['append'])) {
			?>
				<input type="checkbox" id="append" name="append" value="append" checked="checked">
				<label for="append">Save copies of sent messages to IMAP server*</label>
			<?php
			}
			?>
			<div id="loginbtn">
				<input type="submit" value="Log in" />
			</div>
			<?php
			if (!isset($settings['login']['imap']['server'])) {
			?>
				<p style='text-align: center; font-weight: 500;'>Don't know your server details?
				<br>Enter your email address for 'Username' and query:</p>
				<center><input id="lookup-btn" type="button" value="Query Server Info" /></center>
			<?php
			}
			?>

			<p style='text-align: center; font-weight: 500;'><a href="https://github.com/InterLinked1/wssmail" title="All webmail clients suck. This one just sucks less.">wssmail</a></p>
			<p style='text-align: center;'><i>All webmail clients suck. This one just sucks less.</i></p>
			<?php
			if (!isset($settings['login']['imap']['append'])) {
			?>
				<br>
				<p style='font-size: 0.8em;'>*If your mail server supports BURL IMAP or your SMTP server save copies of your messages, you should uncheck this. Otherwise, leave it enabled or copies of messages you send will not be saved anywhere.</p>
			<?php
			}
			?>
		</form>
	</div>
	<script>
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
	if (provider === "Office365") {
		autoconfigure("outlook.office365.com", true, 993, "smtp.office365.com", "starttls", 587, true);
	} else if (provider === "Gmail") {
		autoconfigure("imap.gmail.com", true, 993, "smtp.gmail.com", "tls", 465, false);
	} else if (provider === "Yahoo") {
		autoconfigure("imap.mail.yahoo.com", true, 993, "smtp.mail.yahoo.com", "tls", 465, true);
	} else if (provider === "iCloud") {
		autoconfigure("imap.mail.me.com", true, 993, "smtp.mail.me.com", "starttls", 587, true);
	} else if (provider === "Yandex") {
		autoconfigure("imap.yandex.com", true, 993, "smtp.yandex.com", "tls", 465, true);
	} else if (provider === "PurelyMail") {
		autoconfigure("imap.purelymail.com", true, 993, "smtp.purelymail.com", "tls", 465, true);
	} else if (provider === "Riseup") {
		autoconfigure("mail.riseup.net", true, 993, "mail.riseup.net", "tls", 465, true);
	}
	<?php
	/* This script block is on the page because we need to dynamically created JavaScript here.
	 * There isn't any injection risk, so this is fine. We only send a Content Security Policy
	 * if the user is logged in. */
	if (isset($settings['presets'])) {
		foreach ($settings['presets'] as $preset) {
			echo " else if (provider === '" . $preset['name'] . "') {";
			echo "autoconfigure(";
			echo "'" . $preset['imap']['server'] . "', ";
			echo $preset['imap']['security'] === 'tls' ? "true, " : "false, ";
			echo $preset['imap']['port'] . ", ";
			echo "'" . $preset['smtp']['server'] . "', ";
			echo "'" . $preset['smtp']['security'] . "', ";
			echo $preset['smtp']['port'] . ", ";
			echo $preset['imap']['append'] ? "true" : "false";
			echo ");";
			echo "}";
		}
	}
	?>
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
	</script>
</body>
</html>
	<?php
	die();
}
/* Past this point, we are logged in */

/* Send Content-Security-Policy - help protect against injections from HTML emails, in modern browsers at least */
/* Note that connect-src: 'self' is incorrect because the scheme is different (either ws or wss).
 * Therefore, we have to build that manually */
$wsSource = ($_SERVER['HTTPS'] ? "wss://" : "ws://") . $_SERVER['SERVER_NAME'] . ":" . $_SERVER['SERVER_PORT'];
/* Need to explicitly refer to the current host, for child tabs that are created (since they are about:blank, which is not our current host.) */
$pgSource = ($_SERVER['HTTPS'] ? "https://" : "http://") . $_SERVER['SERVER_NAME'] . ":" . $_SERVER['SERVER_PORT'];
header("Content-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'self' $pgSource; object-src 'self'; child-src 'self' $pgSource; frame-src 'none'; img-src https: data:; worker-src 'none'; media-src 'self'; connect-src $wsSource; font-src 'self'; style-src 'self' $pgSource 'unsafe-inline'; script-src 'self' $pgSource; report-to default;");

function addAddresses($mail, $header, $s) {
	$addresses = explode(',', $s); /* XXX ideally, delimit on either , or ; - but the RFC says , is the right one */
	foreach ($addresses as $address) {
		if (strlen($address) < 1) {
			continue;
		}
		$addr = '';
		$name = '';
		$c = strpos($address, '<');
		if ($c !== false) {
			/* Already in name <email> or <email> format.
			 * Split everything up as needed. */
			$name = substr($address, 0, $c);
			$addr = substr($address, $c + 1);
			$c = strpos($addr, '>');
			if ($c !== false) {
				$addr = substr($addr, 0, $c); /* Strip trailing > */
			}
		} else {
			$addr = $address;
		}
		switch ($header) {
			case 'To':
				$mail->addAddress($addr, $name);
				break;
			case 'Cc':
				$mail->addCC($addr, $name);
				break;
			case 'Bcc':
				$mail->addBCC($addr, $name);
				break;
			case 'From':
				$mail->setFrom($addr, $name); /* Can only be 1 of these, but reuse parsing for it */
				break;
			case 'Reply-To':
				$mail->addReplyTo($addr, $name);
				break;
			default:
				/* Shouldn't happen */
				fprintf(STDERR, "Default case");
				die();
		}
	}
	return $mail;
}

function send_message($send) {
	$progname = "wssmail";
	$progver = "0.1.0";
	/* The only actual mandatory field here is "To". */
	if (strlen($_POST['to']) < 1) {
		return "Missing recipient (To)";
	}
	$from = $_POST['from'];
	$to = $_POST['to'];
	$replyto = $_POST['replyto'];
	$cc = $_POST['cc'];
	$bcc = $_POST['bcc'];
	$subject = $_POST['subject'];
	$inreplyto = $_POST['inreplyto'];
	$references = $_POST['references'];
	$body = $_POST['body'];
	$attachments = $_FILES['attachments'];
	$priority = (int) $_POST['priority'];

	/* We don't need to do any validation here. That's the SMTP server's responsibility.
	 * e.g. validation of the From address, etc.
	 * If something is wrong with the message, it will get rejected and we can just return that error. */

	/* Create the actual message. At this time, we only support plain text messages. */
	$messageid = uniqid() . "@" . $_SESSION['webmail']['server'];

	$msg = "";
	$msg .= "Message-ID: $messageid\r\n";
	$msg .= "Date: " . date(DATE_RFC2822) . "\r\n";
	if (strlen($subject) > 0) {
		$msg .= "Subject: $subject\r\n";
	}
	if (strlen($from) < 1) {
		$from = $_SESSION['webmail']['username']; /* Default to the username (which is probably a user@domain */
	}
	$msg .= "From: $from\r\n";
	if (strlen($replyto) > 0) {
		$msg .= "Reply-To: $replyto\r\n";
	}
	/* comma-delimited */
	$msg .= "To: $from\r\n";
	$msg .= "Content-Type: text/plain; format=flowed\r\n";
	$msg .= "User-Agent: $progname $progver (PHP)\r\n";
	$msg .= "\r\n";
	/* Create a format=flowed plain text body (RFC 3676 - 4.2) */
	$ffbody = "";
	$line = strtok($body, "\n");
	while ($line !== false) {
		rtrim($line); /* Trim spaces before user line breaks */
		if (substr($line, -1) === "\r") {
			/* Also strip CR if present */
			$line = substr($line, 0, -1);
		}
		/* Need to space stuff.
		 * Could use str_starts_with, but use substring for <8 compatibility */
		if (substr($line, 0, 1) === " " || substr($line, 0, 4, "From") || substr($line, 0, 1, ">")) {
			$line = " " . $line;
		}
		/* Now it's deterministic
		 * Wrap each line at 76 characters, with a space after to make it format=flowed.
		 */
		$line = wordwrap($line, 76, " \r\n");
		$ffbody .= $line . "\r\n";
		$line = strtok("\n");
	}

	/* Now we have the plain text component of the body done. */

	$msg .= $ffbody;

	/* Now we have a full message. Time to talk SMTP. */

	try {
		$mail = new PHPMailer();
		$mail->Host = $_SESSION['webmail']['smtpserver'];
		$mail->isSMTP();
		/* By default, these are 5 minutes, which is way too long. Do 15 seconds instead. */
		$mail->getSMTPInstance()->Timeout = 15;
		$mail->getSMTPInstance()->Timelimit = 15;
		if (false) { /* Enable for SMTP debugging */
			$mail->Debugoutput = 'html';
			$mail->SMTPDebug = 3;
		}
		$mail->SMTPAuth = true;
		/* Assume SMTP credentials are the same as the IMAP ones. */
		$mail->Username = $_SESSION['webmail']['username'];
		$mail->Password = $_SESSION['webmail']['password'];
		if ($_SESSION['webmail']['smtpsecure'] === "starttls") {
			$mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
		} else if ($_SESSION['webmail']['smtpsecure'] === "tls") {
			$mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
		} else {
			$mail->SMTPAutoTLS = false; /* If the user did not select encryption, do not attempt it, even if server advertises. */
			$mail->SMTPSecure = "";
		}
		$mail->Port = $_SESSION['webmail']['smtpport'];

		/* Headers */
		$mail = addAddresses($mail, "From", $from);
		$mail = addAddresses($mail, "Reply-To", $replyto);
		$mail = addAddresses($mail, "To", $to);
		$mail = addAddresses($mail, "Cc", $cc);
		$mail = addAddresses($mail, "Bcc", $bcc);

		if (strlen($subject) > 0) {
			$mail->Subject = $subject;
		}

		$mail->isHTML(false);
		$mail->XMailer = ' ';
		if (strlen($references) > 0) {
			$mail->addCustomHeader("References", $references);
		}
		if (strlen($inreplyto) > 0) {
			$mail->addCustomHeader("In-Reply-To", $inreplyto);
		}
		if ($priority !== 3) {
			switch ($priority) {
				case 1:
					$mail->addCustomHeader("X-Priority", "1 (Highest)");
					$mail->addCustomHeader("Importance", "High");
					$mail->addCustomHeader("Priority", "Urgent");
					break;
				case 2:
					$mail->addCustomHeader("X-Priority", "2 (High)");
					$mail->addCustomHeader("Importance", "High");
					$mail->addCustomHeader("Priority", "Urgent");
					break;
				case 4:
					$mail->addCustomHeader("X-Priority", "4 (Low)");
					$mail->addCustomHeader("Importance", "Low");
					$mail->addCustomHeader("Priority", "Non-Urgent");
					break;
				case 5:
					$mail->addCustomHeader("X-Priority", "5 (Lowest)");
					$mail->addCustomHeader("Importance", "Low");
					$mail->addCustomHeader("Priority", "Non-Urgent");
					break;
				case 3:
				default:
					$mail->addCustomHeader("X-Priority", "3 (Normal)");
					$mail->addCustomHeader("Importance", "Normal");
					$mail->addCustomHeader("Priority", "Normal");
					break;
			}
		}
		$mail->addCustomHeader("User-Agent", "$progname $progver (PHP)");
		$mail->Body = $_POST['body'];
		/*! \todo XXX need to send format=flowed !!! */
		//$mail->CharSet = "ISO-8859-1";
		//$mail->addCustomHeader("Content-Type", "text/plain; charset=UTF-8; format=flowed");

		/* Attach attachments */
		$numAttachments = count($_FILES['attachments']['name']);
		for ($i = 0; $i < $numAttachments; $i++) {
			$tmpfile = $_FILES['attachments']['tmp_name'][$i];
			$name = $_FILES['attachments']['name'][$i];
			$mail->addAttachment($tmpfile, $name);
		}

		if ($send) {
			if (!$mail->send()) {
				return $mail->ErrorInfo;
			}
		} else {
			$mail->preSend();
			/* Needed so we can call getSentMIMEMessage */
		}
		if ($_SESSION['webmail']['append']) {
			$sentMessage = $mail->getSentMIMEMessage() . "\r\n"; /* So it's consistent with the message */
			/* Save a copy to the Sent folder.
			 * We have to open a new IMAP connection for this.
			 * In theory, for instances where JS opens the editor as a child tab,
			 * we could pass data "back up" to the parent, and it could use its
			 * existing IMAP connection to do the append, but in the cases of
			 * resubmits, we're basically in our own window, and it's cleaner to
			 * handle it here without involving the parent. */
			$path = "{" . $_SESSION['webmail']['server'] . ":" . $_SESSION['webmail']['port'] . "/imap" . ($_SESSION['webmail']['secure'] ? "/ssl" : "/notls") . "}" . ($send ? "Sent" : "Drafts");
			$imap = imap_open($path, $_SESSION['webmail']['username'], $_SESSION['webmail']['password']);
			$result = imap_append($imap, $path, $sentMessage, "\\Seen", date('d-M-Y H:i:s O'));
			imap_close($imap);
			if (!$result) {
				$e->getTraceAsString();
				return "Failed to save message to $path: " . imap_last_error();
			}
			/* Close IMAP connection and return success */
		}
	} catch (Exception $e) {
		return $mail->ErrorInfo;
	}
	return null;
}

if (isset($_POST['from'], $_POST['to'], $_POST['replyto'], $_POST['cc'], $_POST['bcc'], $_POST['subject'], $_POST['inreplyto'], $_POST['references'], $_POST['body'], $_POST['priority'])) {
	/* Send a message via SMTP, and upload it via IMAP APPEND. Quite another ballgame. */
	if (isset($_POST['send'])) {
		$ret = send_message(true);
	} else if (isset($_POST['savedraft'])) {
		$ret = send_message(false);
	} else {
		$ret = "Unsupported operation?";
	}
	if ($ret !== null) {
		/* Failure. Display the form again. */
		/* XXX Mostly duplicated from editor() JS function */
		$ret .= "<br>Note that if you added any attachments, you will need to re-add them.";
		?>
		<html><head><title>Compose</title><link rel='stylesheet' type='text/css' href='style.css'><link rel='stylesheet' type='text/css' href='form.css'></head><body>
		<p class='error'><?php echo $ret; ?></p>
		<form id='composer' target='' method='post' enctype='multipart/form-data'>
			<div class='form-table'>
			<div><label for='from'>From</label><input type='text' id='from' name='from' value='<?php echo $_POST['from'];?>'></input></div>
			<div><label for='replyto'>Reply To</label><input type='text' id='replyto' name='replyto' placeholder='Same as From' value='<?php echo $_POST['replyto'];?>'></input></div>
			<div><label for='to'>To</label><input type='text' id='to' name='to' value='<?php echo $_POST['to'];?>' required></input></div>
			<div><label for='cc'>Cc</label><input type='text' id='cc' name='cc' value='<?php echo $_POST['cc'];?>'></input></div>
			<div><label for='bcc'>Bcc</label><input type='text' id='bcc' name='bcc' value='<?php echo $_POST['bcc'];?>'></input></div>
			<div><label for='subject'>Subject</label><input type='text' id='subject' name='subject' value='<?php echo $_POST['subject'];?>'></input></div>
			<div><label for='priority'>Priority</label>
			<select name="priority">
				<option value="1">Highest</option>
				<option value="2">High</option>
				<option value="3" selected>Normal</option>
				<option value="4">Low</option>
				<option value="5">Lowest</option>
			</select></div>

			</div>
			<textarea name='body'><?php echo $_POST['body'];?></textarea>
			<input type='hidden' name='inreplyto' value='<?php echo $_POST['inreplyto'];?>'/>
			<input type='hidden' name='references' value='<?php echo $_POST['references'];?>'/>
			<input type='submit' name='send' value='Send'/>
			<input type='submit' name='savedraft' value='Save Draft'/>
			<h4>Attachment(s)</h4>
			<input type='file' name='attachments[]' multiple/>
			</form>
			</div>
		</body></html>
		<?php
	} else {
		?>
		<html><head><title><?php echo $_POST['send'] ? "Sent" : "Saved"; ?></title></head>
		<body><p><b>Message <?php echo $_POST['send'] ? "sent" : "saved to Drafts"; ?> successfully!</b> You may now close this tab.</p>
		</body></html>
		<?php
	}
	die();
}

startHTML();
?>
	<div id="menu">
		<div id="menu-left">
			<p><a href='?' title="All webmail clients suck. This one just sucks less.">Webmail</a> || 
			<a id="reload" href="#" title="Reload current mailbox">&#8635; Reload</a></p>
		</div>
		<div id="menu-center">
			<input id="btn-compose" type="button" value="Compose"/>
			&nbsp;&nbsp;&nbsp;
			<input id="btn-reply" type="button" value="Reply"/>
			<input id="btn-replyall" type="button" value="Reply All"/>
			<input id="btn-forward" type="button" value="Forward"/>
			&nbsp;&nbsp;&nbsp;
			<input id="btn-markunread" type="button" value="Mark Unread"/>
			<input id="btn-markread" type="button" value="Mark Read"/>
			&nbsp;
			<input id="btn-delete" type="button" value="Delete"/>
			<input id="btn-expunge" type="button" value="Expunge"/>
			<select id="option-moveto" name="option-moveto">
				<!-- Dynamically populated with folders -->
			</select>
			<input id="btn-move" type="button" value="Move To"/>
			<input id="btn-copy" type="button" value="Copy To"/>
			<!-- XXX TODO: Add Tag options -->
			<!-- TODO: Add print -->
		</div>
		<div id="menu-right">
			<label for="option-pagesize" title="Number of messages to show on each page">Pg. Sz</label>
			<select id="option-pagesize" name="option-pagesize">
				<!-- Note: Due to current pagesize set logic, these must increment by 5s, starting from 5, to max option -->
				<option value="5">5</option>
				<option value="10">10</option>
				<option value="15">15</option>
				<option value="20">20</option>
				<option value="25">25</option>
				<option value="30">30</option>
				<option value="35">35</option>
				<option value="40">40</option>
				<option value="45">45</option>
				<option value="50">50</option>
			</select>
			<label for="option-preview" title="Enable or disable the message preview pane. If disabled, messages will open in a separate tab.">Preview</label><input id="option-preview" type="checkbox"/>
			<label for="option-html" title="Enable or disable HTML message viewing. If disabled, all messages will be displayed in plain text. Composed messages are always sent as plain text.">HTML</label><input id="option-html" type="checkbox"/>
			<label for="option-extreq" title="Allow HTML emails to load remote content. This allows HTML emails to make external requests, which may consume more bandwidth and allow senders to track you.">&#127760;</label><input id="option-extreq" type="checkbox"/>
			<label for="option-raw" title="View raw message source">Raw</label><input id="option-raw" type="checkbox"/>
			<form target="" method="post">
				<input type="submit" name="logout" value="Logout" />
			</form>
			<input type="hidden" id="fromaddress" value="<?php echo $_SESSION['webmail']['username']; ?>">
		</div>
	</div>
	<div id="main">
		<div id="folders">
			<ul>
				<li>Loading&#133;</li>
			</ul>
		</div>
		<div id="messages">
			<div id="messagelist">
				<table id="messagetable">
				</table>
				<div id="messagepages">
					<!-- This will get replaced with a message list -->
					<p>Select a folder to view messages</p>
				</div>
			</div>
			<div id="previewpane">
			</div>
		</div>
	</div>
	<div id="statusbar">
		<p id="clientname"><a href="https://github.com/InterLinked1/wssmail" target="_blank" title="All webmail clients suck. This one just sucks less.">wssmail</a></p>
		<p id='errorbar' class='error'></p>
		<div id='status-right'>
			<span id='uidnext' title='UIDNEXT'></span>
			<span id='uidvalidity' title='UIDVALIDITY'></span>
			<span id='quota' title='QUOTA'></span>
		</div>
	</div>
	<script src='webmail.js'></script>
</body>
</html>