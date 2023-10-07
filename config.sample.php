<?php
/* DO NOT SET ANY SETTINGS IN THIS FILE.
 * Create a config.php file in this directory, and create your settings there. */

/* Path to composer autoload file. Default is vendor/autoload.php */

# $settings['login']['composer_autoload_path'] = '../vendor/autoload.php';

/* Symmetric key for JWE encryption and decryption. Should be private to the server. See https://web-token.spomky-labs.com/the-components/encrypted-tokens-jwe/jwe-loading
 * This must be configured for 'Remember Me' to work. */

# NOTE: YOU MUST CHANGE THIS KEY!
# $settings['jwt']['key'] = 'dzI6nbW4OcNF-AtfxGAmuyz7IpHRudBI0WgGjZWgaRJt6prBn3DARXgUR8NVwKhfL43QBIU2Un3AvCGCHRgY4TbEqhOi8-i98xxmCggNjde4oaW6wkJ2NgM3Ss9SOX9zS3lcVzdCMdum-RwVJ301kbin4UtGztuzJBeg5oVN00MGxjC2xWwyI0tgXVs-zJs5WlafCuGfX1HrVkIf5bvpE0MQCSjdJpSeVao6-RSTYDajZf7T88a2eVjeW31mMAg-jzAWfUrii61T_bYPJFOXW8kkRWoa1InLRdG6bKB9wQs9-VdXZP60Q4Yuj_WZ-lO7qV9AEFrUkkjpaDgZT86w2g';

/* Hostname of WebSocket backend. By default, WebSocket connections are made to the same hostname
 * from which the website is served, and your backend server can reverse proxy to a different port if needed.
 * If the webmail backend (LBBS net_ws and mod_webmail) are running on a different server than your web server,
 * you can provide the hostname of the BBS server here. This will cause the WebSocket connection
 * to be established to the other server directly.
 * Note that IMAP hostnames are relative to the backend WebSocket server, NOT the frontend web server serving PHP.
 * For example, "localhost" would refer to the backend server, not the frontend server, since the WebSocket server
 * is what establishes the IMAP connection forward, on behalf of the client.
 */

# $settings['websocket']['hostname'] = 'example.com';

/* By default, the WebSocket connection uses HTTP if the website loaded over HTTP
 * and uses HTTPS if the website loaded over HTTPS. However, if your webmail server
 * is using HTTPS but your webmail backend isn't, or vice versa, you should set the security explicitly.
 * WARNING: All connections should use HTTPS if traversing public networks!!!
 */

# $settings['websocket']['https'] = true;

/* WebSocket port. By default, this is port 80 if the website loaded over HTTP
 * and port 443 if the website loaded over HTTPS. */

# $settings['websocket']['port'] = 8143;

/* Base WebSocket URI path to use in the connection. Default is '/webmail' */
# $settings['websocket']['uri'] = '/webmail';

/* If set, these settings will force the settings to the provided configuration,
 * and they will not be user-configurable.
 */

/*
$settings['login']['imap']['server'] = 'example.org';
$settings['login']['imap']['security'] = 'tls'; # tls or none
$settings['login']['imap']['port'] = 993; # IMAP port
$settings['login']['smtp']['server'] = 'example.org';
$settings['login']['smtp']['security'] = 'tls'; # tls, starttls, or none
$settings['login']['smtp']['port'] = 587; # SMTP port
$settings['login']['imap']['append'] = true; # Save copies of sent messages to IMAP server
*/

/* You can configure presets from which users can choose. Be sure to include ALL settings. */

/*
$i = 0;

$settings['presets'][$i]['name'] = 'BBS';
$settings['presets'][$i]['imap']['server'] = 'example.org';
$settings['presets'][$i]['imap']['security'] = 'tls';
$settings['presets'][$i]['imap']['port'] = 993;
$settings['presets'][$i]['smtp']['server'] = 'example.org';
$settings['presets'][$i]['smtp']['security'] = 'starttls';
$settings['presets'][$i]['smtp']['port'] = 587;
$settings['presets'][$i]['imap']['append'] = true;
$i++;

*/

$settings['presets'][$i]['name'] = "Office365";
$settings['presets'][$i]['imap']['server'] = 'outlook.office365.com';
$settings['presets'][$i]['imap']['security'] = 'tls';
$settings['presets'][$i]['imap']['port'] = 993;
$settings['presets'][$i]['smtp']['server'] = 'smtp.office365.com';
$settings['presets'][$i]['smtp']['security'] = 'starttls';
$settings['presets'][$i]['smtp']['port'] = 587;
$settings['presets'][$i]['imap']['append'] = true;
$i++;

$settings['presets'][$i]['name'] = "Gmail";
$settings['presets'][$i]['imap']['server'] = 'imap.gmail.com';
$settings['presets'][$i]['imap']['security'] = 'tls';
$settings['presets'][$i]['imap']['port'] = 993;
$settings['presets'][$i]['smtp']['server'] = 'smtp.gmail.com';
$settings['presets'][$i]['smtp']['security'] = 'tls';
$settings['presets'][$i]['smtp']['port'] = 465;
$settings['presets'][$i]['imap']['append'] = true;
$i++;

$settings['presets'][$i]['name'] = "Yahoo";
$settings['presets'][$i]['imap']['server'] = 'imap.mail.yahoo.com';
$settings['presets'][$i]['imap']['security'] = 'tls';
$settings['presets'][$i]['imap']['port'] = 993;
$settings['presets'][$i]['smtp']['server'] = 'smtp.mail.yahoo.com';
$settings['presets'][$i]['smtp']['security'] = 'tls';
$settings['presets'][$i]['smtp']['port'] = 465;
$settings['presets'][$i]['imap']['append'] = true;
$i++;

$settings['presets'][$i]['name'] = "iCloud";
$settings['presets'][$i]['imap']['server'] = 'imap.mail.me.com';
$settings['presets'][$i]['imap']['security'] = 'tls';
$settings['presets'][$i]['imap']['port'] = 993;
$settings['presets'][$i]['smtp']['server'] = 'smtp.mail.me.com';
$settings['presets'][$i]['smtp']['security'] = 'starttls';
$settings['presets'][$i]['smtp']['port'] = 587;
$settings['presets'][$i]['imap']['append'] = true;
$i++;

$settings['presets'][$i]['name'] = "Yandex";
$settings['presets'][$i]['imap']['server'] = 'imap.yandex.com';
$settings['presets'][$i]['imap']['security'] = 'tls';
$settings['presets'][$i]['imap']['port'] = 993;
$settings['presets'][$i]['smtp']['server'] = 'smtp.yandex.com';
$settings['presets'][$i]['smtp']['security'] = 'tls';
$settings['presets'][$i]['smtp']['port'] = 465;
$settings['presets'][$i]['imap']['append'] = true;
$i++;

$settings['presets'][$i]['name'] = "PurelyMail";
$settings['presets'][$i]['imap']['server'] = 'imap.purelymail.com';
$settings['presets'][$i]['imap']['security'] = 'tls';
$settings['presets'][$i]['imap']['port'] = 993;
$settings['presets'][$i]['smtp']['server'] = 'smtp.purelymail.com';
$settings['presets'][$i]['smtp']['security'] = 'tls';
$settings['presets'][$i]['smtp']['port'] = 465;
$settings['presets'][$i]['imap']['append'] = true;
$i++;

$settings['presets'][$i]['name'] = "Riseup";
$settings['presets'][$i]['imap']['server'] = 'mail.riseup.net';
$settings['presets'][$i]['imap']['security'] = 'tls';
$settings['presets'][$i]['imap']['port'] = 993;
$settings['presets'][$i]['smtp']['server'] = 'mail.riseup.net';
$settings['presets'][$i]['smtp']['security'] = 'tls';
$settings['presets'][$i]['smtp']['port'] = 465;
$settings['presets'][$i]['imap']['append'] = true;
$i++;

?>