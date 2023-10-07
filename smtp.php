<?php
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

function send_message(array $webMailCookie, bool $send) {
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
	$messageid = uniqid() . "@" . $webMailCookie['smtpserver'];

	$msg = "";
	$msg .= "Message-ID: $messageid\r\n";
	$msg .= "Date: " . date(DATE_RFC2822) . "\r\n";
	if (strlen($subject) > 0) {
		$msg .= "Subject: $subject\r\n";
	}
	if (strlen($from) < 1) {
		$from = $webMailCookie['username']; /* Default to the username (which is probably a user@domain */
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
		$mail->Username = $webMailCookie['smtpserver'];
		$mail->Password = $_SESSION['webmail']['password'];
		if ($webMailCookie['smtpsecure'] === "starttls") {
			$mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
		} else if ($webMailCookie['smtpsecure'] === "tls") {
			$mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
		} else {
			$mail->SMTPAutoTLS = false; /* If the user did not select encryption, do not attempt it, even if server advertises. */
			$mail->SMTPSecure = "";
		}
		$mail->Port = $webMailCookie['smtpport'];

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
		if ($webMailCookie['append']) {
			$sentMessage = $mail->getSentMIMEMessage() . "\r\n"; /* So it's consistent with the message */
			/* Save a copy to the Sent folder.
			 * We have to open a new IMAP connection for this.
			 * In theory, for instances where JS opens the editor as a child tab,
			 * we could pass data "back up" to the parent, and it could use its
			 * existing IMAP connection to do the append, but in the cases of
			 * resubmits, we're basically in our own window, and it's cleaner to
			 * handle it here without involving the parent. */
			$path = "{" . $webMailCookie['server'] . ":" . $webMailCookie['port'] . "/imap" . ($webMailCookie['secure'] ? "/ssl" : "/notls") . "}" . ($send ? "Sent" : "Drafts");
			$imap = imap_open($path, $webMailCookie['username'], $_SESSION['webmail']['password']);
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
?>