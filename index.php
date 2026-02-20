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
 * - Basic filtering capabilities (show only unseen, recent messages, etc.)
 * - Status bar includes UIDVALIDITY and UIDNEXT of selected mailboxes
 * - View total number of messages in and size of each mailbox (folder)
 * - Visual identification of marked mailboxes and recent messages
 * - Advanced message operations: copying messages to other mailboxes.
 * - RFC 2177 IMAP IDLE (realtime notifications for current folder)
 * - RFC 5465 IMAP NOTIFY (realtime notifications for other folders)
 * - RFC 6186 autoconfiguration
 * - Raw message downloading (exporting)
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
 * - Forgotten attachment reminder
 * - Single-criterion sorting
 * - Reply using the same identity to which the message was addressed
 * - Hierarchical folder display
 *
 * Very nearly supported:
 * - Sending format=flowed plain text messages
 *
 * Known issues:
 * - Folder list details and title do not update with new/expunged messages (+marked as unread)
 *
 * Not currently supported, but would be nice to have (future roadmap):
 * - Collapsible subfolder trees
 * - Downloading/detaching/deleting attachments.
 * - Resuming or sending email drafts
 * - Displaying messages grouped in threads
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

/* JWT/JWE */
use Jose\Component\Core\AlgorithmManager;
use Jose\Component\Encryption\Algorithm\KeyEncryption\A256KW;
use Jose\Component\Encryption\Algorithm\ContentEncryption\A256CBCHS512;
use Jose\Component\Encryption\Compression\CompressionMethodManager;
use Jose\Component\Encryption\Compression\Deflate;
use Jose\Component\Encryption\JWEBuilder;
use Jose\Component\Core\JWK;
use Jose\Component\Encryption\Serializer\JWESerializerManager;
use Jose\Component\Encryption\Serializer\CompactSerializer;
use Jose\Component\Encryption\JWEDecrypter;
use Jose\Component\Encryption\JWELoader;

$cookieName = 'wssmail_webmail';
$keyCookieName = 'wssmail_clientkey';

if (file_exists('config.php')) {
	require_once('config.php');
}

if (isset($settings['composer_autoload_path'])) {
	require_once($settings['composer_autoload_path']);
} else if (file_exists('vendor/autoload.php')) {
	require_once('vendor/autoload.php');
} else {
	die("Composer path not specified and not autodetected. Please install it!");
}

/* phpversion() gives us M.m.p, we only want M.m */
$mmVersion = substr(phpversion(), 0, 3);
$iniPATH = "/etc/php/$mmVersion/apache2/php.ini";

if (!extension_loaded('imap')) {
	die("PHP imap extension is not available. You may need to install it (e.g. apt-get install php-imap) or uncomment extension=imap in $iniPATH (and restart your web server)");
} else if (!extension_loaded('openssl')) {
	die("PHP openssl extension is not available. You may need to install it or uncomment extension=openssl in $iniPATH (and restart your web server)");
} else if (!extension_loaded('mbstring')) {
	die("PHP mbstring extension is not available. You may need to install it or uncomment extension=mbstring in $iniPATH (and restart your web server)");
}

$serverKey = isset($settings['jwt']['key']) ? $settings['jwt']['key'] : null;

if (isset($_POST['logout'])) {
	if (isset($_COOKIE[$cookieName])) {
		unset($_COOKIE[$cookieName]);
		setcookie($cookieName, '', -1, '/');
	}
	if (isset($_COOKIE[$keyCookieName])) {
		unset($_COOKIE[$keyCookieName]);
		setcookie($keyCookieName, '', -1, '/');
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
	<?php
	if (file_exists("favicon.ico")) {
		echo "<link rel='shortcut icon' href='favicon.ico'>";
	} else {
		?><link rel="icon" href="data:,"> <!-- Inhibit Chrome's automatic favicon download -->
		<?php
	}
	?>
</head>
<body>
	<?php
}

/* Send Content-Security-Policy - help protect against injections from HTML emails, in modern browsers at least */
/* Note that connect-src: 'self' is incorrect because the scheme is different (either ws or wss).
 * Therefore, we have to build that manually */
$wsHostname = isset($settings['websocket']['hostname']) ? $settings['websocket']['hostname'] : $_SERVER['SERVER_NAME'];
$wsSecure = isset($settings['websocket']['https']) ? $settings['websocket']['https'] : isset($_SERVER['HTTPS']);
$wsPort = isset($settings['websocket']['port']) ? $settings['websocket']['port'] : $_SERVER['SERVER_PORT'];
$wsSource = ($wsSecure ? "wss://" : "ws://") . $wsHostname . ":" . $wsPort;
/* Need to explicitly refer to the current host, for child tabs that are created (since they are about:blank, which is not our current host.) */
$pgSource = (isset($_SERVER['HTTPS']) ? "https://" : "http://") . $_SERVER['SERVER_NAME'] . ":" . $_SERVER['SERVER_PORT'];
header("Content-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'self' $pgSource; object-src 'self'; child-src 'self' $pgSource; frame-src 'none'; img-src https: data:; worker-src 'none'; media-src 'self'; connect-src $wsSource; font-src 'self'; style-src 'self' $pgSource 'unsafe-inline'; script-src 'self' $pgSource; report-to default;");

if (isset($_GET['settings'])) {
	startHTML();?>
	<style>
body {
	background-color: tan;
}
#settings {
	padding: 10px;
}
input[type=text] {
	width: 300px;
}
	</style>
	<div id="settings">
		<h1>Settings</h1>
		<p>Note that these settings are saved locally in your browser, and are not account-specific.</p>
		<p>Settings will update immediately when toggled, but some settings (indicated with a <b>*</b>) require you to reload the webmail application.</p>

		<hr>
		<div id="manage-local-settings" class="form-table">
		</div>
		<div id="manage-identities">
			<h3>Aliases</h3>
			<p>Identities you have configured will show up here. You may want to do this if you have aliases for an email account.</p>
			<div id="existing-identities">
				Loading&#133;
			</div>
			<input type='text' id='identity-tbox' placeholder='John Smith &lt;jsmith@example.com&gt;'></input>
			<input type='button' id='remove-identity' value='Remove Identity'/>
			<input type='button' id='add-identity' value='Add Identity'/>
		</div>
		<hr>
		<center><a href="https://github.com/InterLinked1/wssmail" target="_blank">wssmail</a></center>
	</div>
	<script src='settings.js'></script>
	<script src='config.js'></script>
	</body></html>
	<?php
	die();
}

$error = null;

function createJWE(String $serverKey, String $decryptedKey) {
	$keyEncryptionAlgorithmManager = new AlgorithmManager([
		new A256KW(),
	]);
	$contentEncryptionAlgorithmManager = new AlgorithmManager([
		new A256CBCHS512(),
	]);
	$compressionMethodManager = new CompressionMethodManager([
		new Deflate(),
	]);
	$jweBuilder = new JWEBuilder(
		$keyEncryptionAlgorithmManager,
		$contentEncryptionAlgorithmManager,
		$compressionMethodManager
	);
	$jwk = new JWK([
		'kty' => 'oct',
		'k' => $serverKey,
	]);
	$payload = [
		'iat' => time(),
		'nbf' => time(),
		'exp' => time() + ((int) $_POST['loginlimit']),
		'iss' => 'wssmail',
		'aud' => 'wssmail',
		/* Payload body: */
		'clientkey' => $decryptedKey,
	];
	$payload = json_encode($payload);
	$jwe = $jweBuilder
		->create()
		->withPayload($payload)
		->withSharedProtectedHeader([
			'alg' => 'A256KW',	/* Key Encryption Algorithm */
			'enc' => 'A256CBC-HS512',	/* Content Encryption Algorithm */
			'zip' => 'DEF' /* Enable compression */
		])
		->addRecipient($jwk) /* Add recipient (public key) */
		->build();
	$serializer = new CompactSerializer();
	$token = $serializer->serialize($jwe, 0);
	return $token;
}

function decryptJWE(String $serverKey, String $token) {
	$keyEncryptionAlgorithmManager = new AlgorithmManager([
		new A256KW(),
	]);
	$contentEncryptionAlgorithmManager = new AlgorithmManager([
		new A256CBCHS512(),
	]);
	$compressionMethodManager = new CompressionMethodManager([
		new Deflate(),
	]);
	$jwk = new JWK([
		'kty' => 'oct',
		'k' => $serverKey,
	]);

	$jweDecrypter = new JWEDecrypter(
		$keyEncryptionAlgorithmManager,
		$contentEncryptionAlgorithmManager,
		$compressionMethodManager
	);
	$serializerManager = new JWESerializerManager([
		new CompactSerializer(),
	]);
	$jwe = $serializerManager->unserialize($token);
	$success = $jweDecrypter->decryptUsingKey($jwe, $jwk, 0);
	if (!$success) {
		error_log("JWE decryption failure", 0);
		return null;
	}
	$claims = json_decode($jwe->getPayload(), true);
	if (!is_array($claims) || !isset($claims['iat'], $claims['nbf'], $claims['exp'], $claims['iss'], $claims['aud'], $claims['clientkey'])) {
		error_log("JWE is invalid", 0);
		return null;
	}
	$expires = $claims['exp'];
	if ($expires <= time()) {
		error_log("JWE has expired", 0);
		return null;
	}
	return $claims['clientkey'];
}

/* Login page submission */
if (isset($_POST['server'], $_POST['port'], $_POST['smtpserver'], $_POST['smtpport'], $_POST['username'], $_POST['password'], $_POST['security'], $_POST['smtpsecurity'], $_POST['loginlimit'], $_POST['append'])) {
	/* Login submission */
	if (!strlen($_POST['server']) || !strlen($_POST['smtpserver']) || !strlen($_POST['username'])) {
		$error = "Missing required info";
	} else if ($serverKey === null) {
		$error = "Server does not support 'Remember Me' persistent login";
	} else {
		/* Create an HttpOnly cookie with the server info, since JavaScript won't need access to this.
		 * This is stateless, as opposed to using a session (which requires the server to keep track of the state).
		 * All of this data is known to the client (it provided it!), so this is fine.
		 *
		 * The exception is we don't store the plaintext password in the cookie;
		 * indeed, we don't store it any cookie, since the password should not be sent to the server in plaintext automatically.
		 * Instead, we encrypt the password on the client and store that in local storage,
		 * and store the encryption key in the cookie. The encryption key is thus unavailable *directly*
		 * from JavaScript, but the server will have access to it, so can provide it to the client.
		 * The client never sends the encrypted password to the server, so the server can't do anything with the encryption key.
		 * The reason for this complication is to better separate things out: neither the client nor the server on its own
		 * can persistently access the password, i.e. the plaintext password is not stored (and can't be recovered) offline.
		 * This also allows the server to invalidate "Remember Me" by simply
		 * declining to give back the encryption key (e.g. an expired JWT).
		 *
		 * Refining this further, an encrypted encryption key is actually what's stored in the cookie (JWT).
		 * The server encrypts/decrypts the encryption key with a key only known to it.
		 *
		 * The other architectural benefit of not using sessions anymore is that the webmail frontend
		 * and the webmail backend can now easily be on separate servers, since the backend doesn't need
		 * to be able to access the frontend's session data.
		 */

		$cdata = array(
			'server' => $_POST['server'],
			'port' => $_POST['port'],
			'security' => $_POST['security'],
			'smtpserver' => $_POST['smtpserver'],
			'smtpport' => $_POST['smtpport'],
			'smtpsecurity' => $_POST['smtpsecurity'],
			'username' => $_POST['username'],
			'append' => $_POST['append'], /* Whether to upload sent messages to IMAP server */
		);

		/* Remember Me expiration determined by cookie expiration + JWT expiration
		 * The client is free to tamper with the expiration of this cookie,
		 * but it doesn't contain anything sensitive. The client can't
		 * tamper with the expiration of the JWT cookie, since it's signed by the server. */
		setcookie($cookieName, serialize($cdata),
			array(
				'expires' => time() + (int) $_POST['loginlimit'],
				'path' => '/',
				'domain' => $_SERVER['SERVER_NAME'],
				'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'],
				'httponly' => true,
				'samesite' => 'Strict',
			)
		);

		/* User logging in with "Remember Me". Create a JWT to store an encryption key. */
		if (isset($_POST['enckey']) && strlen($_POST['enckey']) > 0) {
			/* This is the "plaintext" key. If we had the password, we could decrypt it, but the client never sends it to us for storage.
			 * Yes, in theory for PLAIN logins, a malicious server could recover it from those, but if it's challenge/response,
			 * then we'd truly have no idea. */
			$decryptedKey = $_POST['enckey'];
			/* Create a JWT (technically, a JWE) to hold the encryption key, encrypted. */
			$jwe = createJWE($serverKey, $decryptedKey);
			setcookie($keyCookieName, $jwe,
				array(
					'expires' => time() + (int) $_POST['loginlimit'],
					'path' => '/',
					'domain' => $_SERVER['SERVER_NAME'],
					'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'],
					'httponly' => true,
					'samesite' => 'Strict',
				)
			);
		}

		/* Reload the page now. This way, if the client reloads later, there's no POST confirmation prompt. */
		header("Location:" . $_SERVER['REQUEST_URI']);
		die();
	}
}

/* Process cookies sent by client */
$webMailCookie = isset($_COOKIE[$cookieName]) ? unserialize($_COOKIE[$cookieName]) : array();

$sendMessage = isset($_POST['from'], $_POST['to'], $_POST['replyto'], $_POST['cc'], $_POST['bcc'], $_POST['subject'], $_POST['inreplyto'], $_POST['references'], $_POST['body'], $_POST['priority']);

require_once('smtp.php');
if (isset($webMailCookie['smtpserver']) && $sendMessage) {
	/* Because of the new client-side password storage scheme,
	 * the password is no longer available to us directly from session storage.
	 *
	 * As a temporary workaround, rely on using Basic Authentication
	 * for SMTP, which ensures the password is not stored server-side,
	 * while temporarily allowing us to use it directly.
	 *
	 * One downside here is that WE do not know if the provided password
	 * is correct, since as soon as we get a password, we provide it to the SMTP server.
	 * If it's wrong, the request will fail, but the client is stuck with
	 * the cached password, thinking it's correct.
	 * To prevent the client from having to manually clear HTTP credentials
	 * and start over, we use a cookie to keep track if the user has ever
	 * successfully sent a message. This way, if SMTP fails for whatever reason,
	 * and no messages have been sent successfully, we can change the realm to
	 * show the page again, but the next request, the user will be prompted
	 * again for Basic Authentication.
	 */
	session_start();
	if (!isset($_SESSION['bauth'])) {
		/* Initialize */
		$_SESSION['bauth']['smtpsuccess'] = false; /* No message has been sent successfully yet. */
		$_SESSION['bauth']['reprompt'] = 0;
		$_SESSION['bauth']['realm'] = "wssmail SMTP";
	}
	if (!isset($_SERVER['PHP_AUTH_PW']) || $_SESSION['bauth']['reprompt'] == 2) {
		$_SESSION['bauth']['reprompt'] = 0; /* Reset */
		$_SESSION['bauth']['realm'] = "wssmail SMTP";
		header("HTTP/1.1 401 Unauthorized");
		header("WWW-Authenticate: Basic realm=\"" . $_SESSION['bauth']['realm'] . "\"");
		$ret = "Failed to send message: No password is available for SMTP authentication.";
	} else {
		/* Send a message via SMTP, and upload it via IMAP APPEND. Quite another ballgame. */
		if (isset($_POST['send'])) {
			$ret = send_message($webMailCookie, true);
		} else if (isset($_POST['savedraft'])) {
			$ret = send_message($webMailCookie, false);
		} else {
			$ret = "Unsupported operation?";
		}
	}
	if ($ret !== null) {
		if (!$_SESSION['bauth']['smtpsuccess']) {
			/* We haven't successfully sent any messages yet during this session.
			 * Assume the error was bad password (even if it wasn't),
			 * so that we can prompt for basic auth again on the next request,
			 * even if it wasn't. We do this by changing the realm.
			 * We don't want to keep prompting for authentication repeatedly,
			 * which is why we count to 2 before reprompting; this ensures
			 * the first attempt goes through no matter what and another
			 * attempt will cause a reauth.
			 *
			 * Note that Chromium-based browsers (including Chrome itself)
			 * exhibit strange behavior with seemingly randomly changing realms.
			 * Doing what we do here is fine, but if prior to send_message,
			 * we were to repeatedly 401 with a realm ending in rand() or time(),
			 * Chrome will repeatedly send the first Basic Auth credentials received
			 * over and over. Mozilla-based browsers do not do this and work as expected.
			 */
			$_SESSION['bauth']['reprompt'] += 1; /* Must be += 1, not = 1 */
			$_SESSION['bauth']['realm'] = "wssmail SMTP " . rand(1, 8192);
		}
		/* Failure. Display the form again. */
		/* XXX Mostly duplicated from editor() JS function */
		$ret .= "<br>Note that if you added any attachments, you will need to re-add them.";
		if ($_SESSION['bauth']['reprompt'] == 1) {
			$ret .= "<br>If you were just prompted for authentication, you may have entered the wrong password; try sending again to be prompted to reauthenticate. If you see this error repeatedly and you did not elect to use STARTTLS or TLS, it is likely your SMTP server requires encryption to authenticate.";
		}
		?>
		<html><head><title>Compose</title><link rel='stylesheet' type='text/css' href='style.css'><link rel='stylesheet' type='text/css' href='form.css'></head><body>
		<p class='error'><?php echo $ret; ?></p>
		<form id='composer' target='' method='post' enctype='multipart/form-data'>
			<div class='form-table'>
			<div><label for='from'>From</label><input type='text' id='from' name='from' value='<?php echo htmlentities($_POST['from'], ENT_QUOTES);?>'></input></div>
			<div><label for='replyto'>Reply To</label><input type='text' id='replyto' name='replyto' placeholder='Same as From' value='<?php echo htmlentities($_POST['replyto'], ENT_QUOTES);?>'></input></div>
			<div><label for='to'>To</label><input type='text' id='to' name='to' value='<?php echo htmlentities($_POST['to'], ENT_QUOTES);?>' required></input></div>
			<div><label for='cc'>Cc</label><input type='text' id='cc' name='cc' value='<?php echo htmlentities($_POST['cc'], ENT_QUOTES);?>'></input></div>
			<div><label for='bcc'>Bcc</label><input type='text' id='bcc' name='bcc' value='<?php echo htmlentities($_POST['bcc'], ENT_QUOTES);?>'></input></div>
			<div><label for='subject'>Subject</label><input type='text' id='subject' name='subject' value='<?php echo htmlentities($_POST['subject'], ENT_QUOTES);?>'></input></div>
			<div><label for='priority'>Priority</label>
			<select name="priority">
				<option value="1">Highest</option>
				<option value="2">High</option>
				<option value="3" selected>Normal</option>
				<option value="4">Low</option>
				<option value="5">Lowest</option>
			</select></div>

			</div>
			<textarea id='compose-body' name='body'><?php echo htmlspecialchars($_POST['body']);?></textarea>
			<input type='hidden' name='inreplyto' value='<?php echo htmlentities($_POST['inreplyto'], ENT_QUOTES);?>'/>
			<input type='hidden' name='references' value='<?php echo htmlentities($_POST['references'], ENT_QUOTES);?>'/>
			<input type='submit' id='btn-send' name='send' value='Send'/>
			<input type='submit' name='savedraft' value='Save Draft'/>
			<h4>Attachment(s)</h4>
			<input type='file' id='compose-attachments' name='attachments[]' multiple/>
			</form>
			</div>
		</body>
		<script src='compose.js'></script>
		</html>
		<?php
	} else {
		$_SESSION['bauth']['smtpsuccess'] = true;
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
	<div id="login-container">
		<form id="login" target="" method="post">
			<p class='error'><?php echo !is_null($error) ? $error : "";?></p>
			<div class='form-table'>
				<?php /* XXX Improvement: allow presetting settings via GET parameters and prefill them in here? Or maybe presets are good enough? */ ?>
				<?php
				/* Note:
				 * It was originally intended that the cookie containing server connection info could be sent directly to backend servers in the WebSocket upgrade.
				 * However, this does not work because if the backend server is using a different hostname, the cookie won't be sent since cookies are same origin only,
				 * and it's not worth trying to work around that. Therefore, the frontend server extracts all the needed info from the cookie here
				 * and injects it into the page, so that JavaScript can use this for the WebSocket upgrade. */
				if (!isset($settings['login']['imap']['server'])) {
				?>
					<div>
						<label for="loginpreset">Provider Preset</label>
						<select name="loginpreset" id="loginpreset">
							<option value=""></option>
							<?php
							if (isset($settings['presets'])) {
								foreach ($settings['presets'] as $preset) {
									/* If a cookie saved, we are going to attempt autologin anyways immediately, so no point in obeying the preset for that. */
									$selected = (isset($defaultPreset) && $defaultPreset === $preset['name']) && !isset($webMailCookie['username']) ? " selected" : "";
									echo "<option value='" . $preset['name'] . "'$selected>" . $preset['name'] . "</option>";
								}
							}
							?>
						</select>
					</div>
				<?php
				}
				if (!isset($settings['login']['imap']['server'])) {
				?>
					<div>
						<label for="server">IMAP Server</label><input type="text" id="server" name="server" value="<?php echo isset($webMailCookie['server']) ? $webMailCookie['server'] : 'localhost';?>"/>
					</div>
				<?php
				}
				if (!isset($settings['login']['imap']['security'])) {
				?>
					<div>
						<label>IMAP Security</label>
						<div>
							<input type="radio" id="security-plain" name="security" value="none"<?php echo !isset($webMailCookie['security']) || $webMailCookie['security'] === 'none' ? ' checked' : '';?>/>
							<label for="security-plain">None</label>
							<input type="radio" id="security-tls" name="security" value="tls"<?php echo isset($webMailCookie['security']) && $webMailCookie['security'] === 'tls' ? ' checked' : '';?>/>
							<label for="security-tls">TLS</label>
						</div>
					</div>
				<?php
				}
				if (!isset($settings['login']['imap']['port'])) {
				?>
					<div>
						<label for="port">IMAP Port</label><input type="number" id="port" name="port" value="<?php echo isset($webMailCookie['port']) ? $webMailCookie['port'] : '143';?>"/>
					</div>
				<?php
				}
				if (!isset($settings['login']['smtp']['server'])) {
				?>
					<div>
						<label for="smtpserver">SMTP Server</label><input type="text" id="smtpserver" name="smtpserver" value="<?php echo isset($webMailCookie['smtpserver']) ? $webMailCookie['smtpserver'] : 'localhost';?>"/>
					</div>
				<?php
				}
				if (!isset($settings['login']['smtp']['security'])) {
				?>
					<div>
						<label>SMTP Security</label>
						<div>
							<input type="radio" id="smtp-security-plain" name="smtpsecurity" value="none" <?php echo !isset($webMailCookie['smtpsecurity']) || $webMailCookie['smtpsecurity'] === "none" ? 'checked' : '';?>/>
							<label for="smtp-security-plain">None</label>
							<input type="radio" id="smtp-security-starttls" name="smtpsecurity" value="starttls"" <?php echo isset($webMailCookie['smtpsecurity']) && $webMailCookie['smtpsecurity'] === "starttls" ? 'checked' : '';?>/>
							<label for="smtp-security-starttls">STARTTLS</label>
							<input type="radio" id="smtp-security-tls" name="smtpsecurity" value="tls"" <?php echo isset($webMailCookie['smtpsecurity']) && $webMailCookie['smtpsecurity'] === "tls" ? 'checked' : '';?>/>
							<label for="smtp-security-tls">TLS</label>
						</div>
					</div>
				<?php
				}
				if (!isset($settings['login']['smtp']['port'])) {
				?>
					<div>
						<label for="port">SMTP Port</label><input type="number" id="smtpport" name="smtpport" value="<?php echo isset($webMailCookie['smtpport']) ? $webMailCookie['smtpport'] : '587';?>"/>
					</div>
				<?php
				}
				?>
				<div>
					<label for="login-username">Username</label><input type="text" id="login-username" name="username" autocomplete="username" value="<?php echo isset($webMailCookie['username']) ? $webMailCookie['username'] : '';?>"/>
				</div>
				<div>
					<label for="login-password">Password</label><input type="password" id="login-password" name="password" autocomplete="current-password" value=""/>
				</div>

				<div>
					<label for="loginlimit">Time to stay logged in</label>
					<select name="loginlimit" id="loginlimit">
						<option value="0">Never</option>
						<?php
						if ($serverKey !== null) {
							?>
							<option value="1800">Half an hour</option>
							<option value="3600">1 hour</option>
							<option value="7200">2 hours</option>
							<option value="86400">1 day</option>
							<option value="604800">1 week</option>
							<option value="2592000">1 month</option>
							<?php
						}
						?>
					</select>
				</div>
				<div>
					<label for="authmethod">Authentication Method</label>
					<select name="authmethod" id="authmethod">
						<option value="auto">Autoselect Most Secure</option>
						<option value="PLAIN">PLAIN</option>
						<option value="none">None (Connect only, no login)</option>
					</select>
				</div>
				<input type="hidden" id="enckey" name="enckey" value=""/>
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
			/* These hidden inputs don't need to be sent to the server, they are only used locally, which is why they only have an ID (for JavaScript) but no name */
			if (isset($_COOKIE[$keyCookieName]) && $serverKey !== null) {
				/* Decrypt the client's key from the JWE and send it the plaintext key, which it can use to decrypt its encrypted password */
				$clientKey = decryptJWE($serverKey, $_COOKIE[$keyCookieName]);
				if ($clientKey !== null) {
					/* We just embed the key in the page, so that JavaScript has access to it.
					 * If we return it in a response header, JavaScript can't access that. */
					echo "<input type='hidden' id='clientkey' value='$clientKey'/>";
					if (isset($webMailCookie['username'])) {
						/* If the client sent a cookie, autologin */
						echo "<input type='hidden' id='autologin' value='1'/>";
					}
				}
			}
			if (isset($_POST['logout'])) {
				echo "<input type='hidden' id='autologout' value='1'/>";
			}
			if (isset($settings['websocket']['hostname'])) {
				echo "<input type='hidden' id='websocket-host' value='" . $settings['websocket']['hostname'] . "'/>";
			}
			if (isset($settings['websocket']['https'])) {
				echo "<input type='hidden' id='websocket-https' value='" . ($settings['websocket']['https'] ? 1 : 0) . "'/>";
			}
			if (isset($settings['websocket']['port'])) {
				echo "<input type='hidden' id='websocket-port' value='" . $settings['websocket']['port'] . "'/>";
			}
			if (isset($settings['websocket']['uri'])) {
				echo "<input type='hidden' id='websocket-uri' value='" . $settings['websocket']['uri'] . "'/>";
			}
			?>
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
			<noscript><p style='text-align: center; font-weight: 900; font-size: 1.5em;'>This application requires JavaScript to function &mdash; please enable it and reload!</p></noscript>
		</form>
	</div>
	<div id="presets" class="default-hidden">
		<?php
		/* Embed presets into the page so static JavaScript can access these */
		if (isset($settings['presets'])) {
			foreach ($settings['presets'] as $preset) {
				/* Use name instead of id, since name can contain spaces */
				echo "<div name='preset-" . $preset['name'] . "'>";
				echo "<input type='hidden' name='server' value='" . $preset['imap']['server'] . "'/>";
				echo "<input type='hidden' name='security' value='" . ($preset['imap']['security'] === 'tls' ? 1 : 0) . "'/>";
				echo "<input type='hidden' name='port' value='" . $preset['imap']['port'] . "'/>";
				echo "<input type='hidden' name='smtpserver' value='" . $preset['smtp']['server'] . "'/>";
				echo "<input type='hidden' name='smtpsecurity' value='" . $preset['smtp']['security'] . "'/>";
				echo "<input type='hidden' name='smtpport' value='" . $preset['smtp']['port'] . "'/>";
				echo "<input type='hidden' name='append' value='" . ($preset['imap']['append'] ? 1 : 0) . "'/>";
				echo "</div>";
				echo PHP_EOL;
			}
		}
		?>
	</div>
	<div id="webmail-container" class="default-hidden">
		<div id="menu">
			<div id="menu-left">
				<p><a href='?' title="All webmail clients suck. This one just sucks less.">&#8962;</a> || 
				<a id="reload" href="#" title="Reload current mailbox">&#8635;</a></p>
			</div>
			<div id="menu-center">
				<input id="btn-compose" type="button" title="Compose" value="&#128394;"/>

				<label id="btn-upload-label" title="Append (Upload Message To Folder)" for="btn-upload">&uarr;</label>
				<input id="btn-upload" type="file"/>

				&nbsp;&nbsp;&nbsp;
				<input id="btn-reply" type="button" title="Reply" value="&larr;"/>
				<input id="btn-replyall" type="button" title="Reply All" value="&Larr;"/>
				<input id="btn-forward" type="button" title="Forward" value="&#10150;"/>
				&nbsp;&nbsp;&nbsp;
				<input id="btn-markunread" type="button" title="Mark Unread" value="&#128233;"/>
				<input id="btn-markread" type="button" title="Mark Read" value="&#9993;"/>
				&nbsp;
				<input id="btn-flag" type="button" title="Flag" value="&#9873;"/>
				<input id="btn-unflag" type="button" title="Unflag" value="&#127937;"/>
				<input id="btn-junk" type="button" title="Junk/Spam" value="&#128293;"/>
				<input id="btn-delete" type="button" title="Delete" value="&#10060;"/>
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
				<label for="option-pagesize" title="Sort order">Sort</label>
				<select id="option-sort" name="option-sort">
					<option value="none">None</option>
					<option value="sent-desc">Sent &darr;</option>
					<option value="sent-asc">Sent &uarr;</option>
					<option value="received-desc">Rcvd &darr;</option>
					<option value="received-asc">Rcvd &uarr;</option>
					<option value="size-desc">Size &darr;</option>
					<option value="size-asc">Size &uarr;</option>
					<option value="subject-asc">Subject &uarr;</option>
					<option value="subject-desc">Subject &darr;</option>
					<option value="from-asc">From &uarr;</option>
					<option value="from-desc">From &darr;</option>
					<option value="to-asc">To &uarr;</option>
					<option value="to-desc">To &darr;</option>
				</select>
				<label for="option-filter" title="Simple filter">Filter</label>
				<select id="option-filter" name="option-filter">
					<option value="none">None</option>
					<option value="recent">Recent</option>
					<option value="unseen">Unseen</option>
				</select>
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
				<b><input type="button" id="btn-download" title="Download (Export)" value="&#10149;" /></b> <!-- Also &#128233; -->
				<form target="" method="post">
					<input type="submit" name="logout" value="Logout" />
				</form>
				<input type="hidden" id="fromaddress" value="<?php echo isset($webMailCookie['username']) ? $webMailCookie['username'] : ""; ?>">
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
						<noscript>This application requires JavaScript to function.</noscript>
					</div>
				</div>
				<div id="previewpane">
				</div>
			</div>
		</div>
	</div>
	<div id="statusbar">
		<p id="clientname"><a href="https://github.com/InterLinked1/wssmail" target="_blank" title="All webmail clients suck. This one just sucks less.">wssmail</a> || <a href='<?php echo $_SERVER['REQUEST_URI'] . (strpos($_SERVER['REQUEST_URI'], '?') !== false ? '&' : '?') . 'settings'; ?>' target='_blank'>Settings</a></p>
		<p id='errorbar' class='error'></p>
		<div id='status-right'>
			<span id='uidnext' title='UIDNEXT'></span>
			<span id='uidvalidity' title='UIDVALIDITY'></span>
			<span id='quota' title='QUOTA'></span>
		</div>
	</div>
	<script src='settings.js'></script>
	<script src='webmail.js'></script>
	<script src='login.js'></script>
</body>
</html>