<?php
/* SMTP */
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;
use PHPMailer\PHPMailer\Exception;

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

function generateUUID() {
	/* Manually generate a UUID, PHP has no builtin support for this */
	$uuidData = random_bytes(16);
	$uuidData[6] = chr(ord($uuidData[6]) & 0x0f | 0x40); /* Set version to 0100 */
	$uuidData[8] = chr(ord($uuidData[8]) & 0x3f | 0x80); /* Set bits 6-7 to 10 */
	return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($uuidData), 4));
}

function send_message(array $webMailCookie, bool $send) {
	global $settings;
	$smtpDebug = false; /* Enable for SMTP debugging */
	$connInfo = "Connecting to ";
	$progname = "wssmail";
	$progver = "0.1.1";
	/* The only actual mandatory fields here is "To". */
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

	/* Only the password from basic authentication is used.
	 * The username is ignored; we use the username from the cookie. */
	$password = $_SERVER['PHP_AUTH_PW'];

	/* We don't need to do any validation here. That's the SMTP server's responsibility.
	 * e.g. validation of the From address, etc.
	 * If something is wrong with the message, it will get rejected and we can just return that error. */

	/* Create the actual message. At this time, we only support plain text messages. */
	$messageid = uniqid() . "@" . $webMailCookie['smtpserver'];

	$msg = "";
	$msg .= "Message-ID: $messageid\r\n";
	$msg .= "Date: " . date(DATE_RFC2822) . "\r\n";
	if (strlen($subject) > 0) {
		$msg .= "Subject: $subject\r\n";
	}
	if (!(strlen($from) > 0)) {
		$from = $webMailCookie['username']; /* Default to the username (which is probably a user@domain) */
	}
	if (!(strlen($from) > 0)) {
		return "Missing From";
	}

	$msg .= "From: $from\r\n";
	if (strlen($replyto) > 0) {
		$msg .= "Reply-To: $replyto\r\n";
	}
	/* comma-delimited */
	$msg .= "To: $from\r\n";
	$msg .= "Content-Type: text/plain; format=flowed\r\n";
	$msg .= "User-Agent: $progname $progver (https://github.com/InterLinked1/wssmail)\r\n";
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
		if (substr($line, 0, 1) === " " || substr($line, 0, 4) === "From" || substr($line, 0, 1) === ">") {
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
		$mail->Host = $webMailCookie['smtpserver'];
		$connInfo .= $mail->Host;
		$mail->isSMTP();
		/* By default, these are 5 minutes, which is way too long. Do 15 seconds instead. */
		$mail->getSMTPInstance()->Timeout = 15;
		$mail->getSMTPInstance()->Timelimit = 15;
		if ($smtpDebug) {
			$mail->Debugoutput = 'html';
			$mail->SMTPDebug = 3;
		}
		$mail->SMTPAuth = true;
		/* Assume SMTP credentials are the same as the IMAP ones. */
		$mail->Username = $webMailCookie['username'];
		$mail->Password = $password;
		$mail->Port = $webMailCookie['smtpport'];
		$connInfo .= " port " . $mail->Port;
		if ($webMailCookie['smtpsecurity'] === "starttls") {
			$mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
			$connInfo .= " (STARTTLS)";
		} else if ($webMailCookie['smtpsecurity'] === "tls") {
			$mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
			$connInfo .= " (TLS)";
		} else {
			$mail->SMTPAutoTLS = false; /* If the user did not select encryption, do not attempt it, even if server advertises. */
			$mail->SMTPSecure = "";
			$connInfo .= " (unencrypted)";
		}

		/* It's okay if the cert doesn't validate if we're connecting to an exempt server. */
		if (isset($settings['tls']['noverify']) && in_array($mail->Host, $settings['tls']['noverify'])) {
			$mail->SMTPOptions = array(
				'ssl' => array(
					'verify_peer' => false,
					'verify_peer_name' => false,
					'allow_self_signed' => true
				)
			);
		}

		/* The default Message-ID generated by PHPMailer uses the domain of the PHP application, not of the SMTP server.
		 * This can leak information if a private webmail application is being used since the HTTP hostname is what gets used.
		 * Just as bad, if the hostname is an IP address, then that will get used instead, which makes no sense.
		 *
		 * Override the hostname portion of the Message-ID to use the domain of the From address, not the website hostname. */
		$fromDomain = substr(strrchr($from, "@"), 1); /* The domain is everything after the last '@' */
		$mail->MessageID = "<" . generateUUID() . "@" . $fromDomain . ">";

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
				return $connInfo . "<br>" . $mail->ErrorInfo;
			}
		} else {
			$mail->preSend();
			/* Needed so we can call getSentMIMEMessage */
		}
		if ($webMailCookie['append']) {
			$sentMessage = $mail->getSentMIMEMessage() . "\r\n"; /* So it's consistent with the message */
			/* Save a copy to the Sent folder.
			 * We have to open a new IMAP connection for this.
			 * In theory, for instances where JS opens the editor as a child tab,
			 * we could pass data "back up" to the parent, and it could use its
			 * existing IMAP connection to do the append, but in the cases of
			 * resubmits, we're basically in our own window, and it's cleaner to
			 * handle it here without involving the parent. */
			$path = "{" . $webMailCookie['server'] . ":" . $webMailCookie['port'] . "/imap" . ($webMailCookie['security'] === 'tls' ? "/ssl" : "/notls") . "}" . ($send ? "Sent" : "Drafts");
			$imap = imap_open($path, $webMailCookie['username'], $password);
			if ($imap === false) {
				return "Message sent, but failed to save copy of message to $path: " . imap_last_error();
			}
			$result = imap_append($imap, $path, $sentMessage, "\\Seen", date('d-M-Y H:i:s O'));
			if ($webMailCookie['security'] !== 'tls') {
				/* By default, PHP will log this notice to the error log for unencrypted IMAP servers offering AUTH=PLAIN:
				 * PHP Notice:  PHP Request Shutdown: SECURITY PROBLEM: insecure server advertised AUTH=PLAIN (errflg=1)
				 * This can be ignored, so suppress from the logs by calling the error functions to flush the error before closing. */
				imap_errors();
				imap_alerts();
			}
			imap_close($imap);
			if (!$result) {
				return "Message sent, but failed to save copy of message to $path: " . imap_last_error();
			}
			/* Close IMAP connection and return success */
		}
	} catch (Exception $e) {
		return $connInfo . "<br>" . $mail->ErrorInfo;
	}
	return null;
}
?>