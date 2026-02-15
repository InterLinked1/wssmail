# wssmail
**Advanced realtime webmail client**

**wssmail** is a fast webmail client for IMAP power users who are accustomed to the rich functionality of a desktop mail client (e.g. Thunderbird, Interlink, etc.). Our motto (similar to mutt's) is that *all webmail clients suck, this one just sucks less*. Webmail is a fundamentally limited technology, but we believe that webmail can be better than what existing webmail solutions have to offer. That's why wssmail was created.

## Differentiating Features

Why yet another webmail package? There are a few key features and capabilities that set wssmail apart from other open source webmail projects:

- **Realtime email notifications (RFC 2177 IMAP IDLE)**. IDLE is the IMAP technology that allows mail clients to receive realtime notifications of new or deleted messages in a folder. You can think of it like "push notifications" for email.

    Most, if not nearly all, existing webmail clients do not support IDLE, because IDLE requires keeping a persistent TCP connection open to the IMAP server, over which to receive updates. Webmail traditionally has not been able to support this, because webpages by their nature typically do a page load at a fixed point in time, and after the HTTP connection is closed, further data cannot be received unsolicited from the web server. SquirrelMail, for example, works exactly like this: it does a full page load for every operation (no JavaScript at all). RoundCube uses AJAX to perform operations without reloading the entire page, but this is still fundamentally limited by the request/response model of HTTP.

    wssmail is different. wssmail uses WebSockets, a browser technology that has been available now for quite some time, to be able to receive unsolicited data from the web server at any time. This allows IDLE to be supported, which makes users' email workflow much more efficient, since we don't need to poll for new messages - you'll be notified instantly of them. Additionally, because all data sent/received uses the existing WebSocket connection, new TCP connections don't need to be established as with AJAX, which means everything overall is faster and more responsive.

- **Speed** - As elaborated in the previous point, wssmail uses WebSockets, not full page loads or AJAX. Because this allows a single and persistent TCP connection to be used for all data exchange, there is no overhead to performing mailbox actions during a session.

- **Interface** - Most existing webmail clients (including popular commercial ones, like Gmail, Yahoo, etc.) have an extremely simplistic interface that lacks many details available in traditional mail clients. These are details available in wssmail not typically available in webmail interfaces:

    - Number of messages in each folder
    - Size of each folder
    - Sent *and* Received times of emails
    - Size of each message
    - Priority of each message
    - Recipient of the message
    - Sequence number and UID in the mailbox (real mail clients don't show these either, but this may be useful or interesting to those familiar with IMAP)

    Additionally, the interface is customizable:
    - Optional preview pane
    - Customizable number of messages to display per page
    - View plain text, HTML, or raw message source, and toggle easily at any time

- **Operation Support** - wssmail lets you do the following operations, which are supported in traditional mail clients but rarely supported in webmail:

    - Copy (not move) messages between folders
    - Set the priority of outgoing messages
    - Set the Reply To address of outgoing messages

- **Lightweight** - wssmail was developed to be a small project, very lightweight and easy to work on. Personally, I am mainly a C developer and not a JavaScript fan, and I've focused on keeping the codebase as simple as possible. The entire frontend (HTML, CSS, and JavaScript) is under 3,000 lines of code currently. That will probably grow over time, but it shows you don't need MBs of libraries in order to create something useful. (The backend is also under 4,000 lines of C code). This makes wssmail very fast to load, and easy for people to understand how it works and contribute to it.

**Note:**

Do note that wssmail is new and still lacks some capabilities that may be expected as development continues. Refer to the top of index.php for a list of these items. In particular, the focus thus far has been on function over form, so not much attention has been given to making things "look nice" yet.

## Installing

wssmail comes in two components:

- Frontend, housed in this repository. This is all the HTML, CSS, and JavaScript, as well as sending emails.

- Backend, which is an [LBBS](https://github.com/InterLinked1/lbbs) module. This is the part that interacts with the user's IMAP server. The frontend communicates with the backend via a WebSocket connection.

Both are required to make wssmail work. In theory, the components could each have multiple different implementations, too, but currently there is only one of each.

No configuration is required of the backend (apart from the WebSocket server port in `net_ws.conf`); as long as you have LBBS running with the appropriate modules loaded, the backend should be good to go. Refer to the [LBBS](https://github.com/InterLinked1/lbbs) repository for more details on that.

The frontend requires the PHP `imap` and `openssl` extensions for SMTP. Please make sure they are enabled. The JWT/JWE functionality requires PHP's mbstring extension. You can ensure the PHP and Apache-related (if you are using Apache to reverse proxy) dependencies are satisfied by running the following:

```
apt-get install php-imap php-mbstring
a2enmod rewrite proxy proxy_wstunnel
service apache2 restart
```

`php-imap` was removed in PHP 8.4, so if you were using a recent version of PHP, the package may be "unavailable". You can work around this by using the sury repository, e.g.:

```
# Install using the sury repo for Debian packages that still support php-imap (removed in PHP 8.4)
apt-get install -y curl
curl -sSLo /tmp/php.sh https://packages.sury.org/php/README.txt && sh /tmp/php.sh && rm /tmp/php.sh

# Install required packages
apt-get install -y apache2 php8.5 php8.5-{common,mbstring,imap}
a2enmod php8.5 rewrite proxy proxy_wstunnel
```

To install the frontend, you will need Composer. Once you have cloned this repository into the web directory where it will be hosted, run:
```
wget https://raw.githubusercontent.com/composer/getcomposer.org/main/web/installer -O - -q | php -- --quiet
php composer.phar install
```

Alternately, if you already have PHPMailer via Composer on your system, you can specify the path to the autoload file in `config.php`.

Basic configuration of your frontend web server is required for the frontend site. There are three ways you can host this application:

* Run the frontend and backend on separate servers. You'll need to specify the WebSocket server info in `config.php`.
* Run the frontend and backend on the same server, and reverse proxy WebSocket connections to the backend. This could be done as follows, for an Apache HTTP virtualhost:

```
RewriteEngine On
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule /(.*)           ws://localhost:8143/webmail [P,L]
```

* Run the frontend and backend on separate servers, and reverse proxy WebSocket connections to the backend server. The Apache HTTP configuration would be as the previous one, with localhost substituted for the backend server. One reason to prefer this over the first optio (directly specifying the backend WebSocket connection details in the configuration) is the WebSocket server wouldn't be required to use TLS, since this will be offloaded to the Apache WebSocket connection before it's reverse-proxied.

(This assumes that 8143 is your WebSocket port, as configured in LBBS's `net_ws.conf`). Note that this connection is not encrypted, but if this is a loopback connection, it does not matter.
If you are running the components on different servers, be sure to use TLS for everything unless the network is trusted.

### Networking Note

There are four different server roles involved with this webmail program, all of which could theoretically be running on different servers (but, in the simplest configuration, could all be roles running on the same server). They are:

* Frontend web server, running a web server of your choice (e.g. Apache HTTP web server) and PHP. This is what receives requests directly from the user. Some operations, like sending mail using SMTP and uploading copies of sent mail via IMAP, are performed directly by the frontend server using the `php_imap` plugin.
* Backend server, running LBBS. This handles WebSocket connections from the frontend (using LBBS's `net_ws`) and sets up a persistent IMAP connections used for most operations, leveraging LBBS's `mod_webmail`, which itself uses the `libetpan` email client library.
* IMAP server
* SMTP server

### Configuration Note

There are caveats and "gotchas" to the configuration, depending on your server arrangement. In particular, to connect to a mail server running on the same machine as either the frontend or the backend web server, you should **NOT** use `localhost` for any configuration, such as server hostnames for IMAP or SMTP, if your frontend and backend servers are different (i.e. not running on the same machine).

The reason for this is that while most connections to the IMAP server are originated from the backend server, certain IMAP connections as well as all SMTP connections are originated directly from the frontend web server. This means if `localhost` is used for either of these settings, `localhost` on the frontend and backend servers will each refer to themselves, rather than to the same web server. Due to the differing frames of reference, certain operations will fail unless both web servers happen to be running IMAP/SMTP as well (which, even if they were, is very likely not the configuration you intended). For example, you may be able to successfully send a message, but then upload the copy of the sent message to the wrong server, or fail to upload it altogether. To work around this, use only "absolute" IP addresses that unambigously refer to the same host on both web servers.

If your frontend web server, backend server, and IMAP/SMTP services are all truly running on the same machine, then there is no risk to using `localhost`. As a good rule of thumb, when multiple servers are involved, avoid using `localhost` anywhere, particularly for the IMAP server hostname, since depending on if the frontend or the backend is carrying out the operation, this would refer to different servers.

## Configuring

The client is meant to be readily usable as a generic web-based IMAP and SMTP client right out of the box: it really is plug'n play. However, there are a few things that can be configured, if desired. These are documented in `config.sample.php`. To apply settings, create a `config.php` and put them there.

One thing you will want to consider is the server key, used for encrypting JWTs (JWEs). This is set at the top of `config.php`. Be sure to change the default key to something private to the frontend server!

By default, wssmail may be used with any mail server on demand. If you would like to restrict the webmail client to a particular mail server, for instance (which is typical with many deployed webmail sites, which are coupled to a specific mail server), you can force the server settings:

```
$settings['login']['imap']['server'] = 'example.org';
$settings['login']['imap']['security'] = 'tls'; # tls or none
$settings['login']['imap']['port'] = 993; # IMAP port
$settings['login']['smtp']['server'] = 'example.org';
$settings['login']['smtp']['security'] = 'tls'; # tls, starttls, or none
$settings['login']['smtp']['port'] = 587; # SMTP port
$settings['login']['imap']['append'] = true; # Save copies of sent messages to IMAP server
```

You can force as few or many settings as you want to. Forced settings will no longer appear in the login UI.

You can also configure your own presets, if desired, that can be selected from a dropdown:
```
$settings['presets'][0]['name'] = 'BBS';
$settings['presets'][0]['imap']['server'] = 'example.org';
$settings['presets'][0]['imap']['security'] = 'tls';
$settings['presets'][0]['imap']['port'] = 993;
$settings['presets'][0]['smtp']['server'] = 'example.org';
$settings['presets'][0]['smtp']['security'] = 'starttls';
$settings['presets'][0]['smtp']['port'] = 587;
$settings['presets'][0]['imap']['append'] = true;
```

Unlike forced settings, if you create a preset, you *must* configure **ALL** the settings for that connection.

## FAQ

### How can I see labels for mail actions, rather than icons?

Icons are used by default to save space in the menu.

If you'd rather see icons, open "Settings" from the lower-left corner and enable "Force Labels".

Reload the page, and you'll now see labels in your current browser, unless/until you change that setting.

### Why was wssmail created?

wssmail was created because *all webmail clients suck, this one just sucks less*. I have pretty much always hated webmail because of how primitive and simplistic it is. I don't regularly use webmail, either; I use a traditional mail client, and I have a lot of email accounts so using webmail to manage just a single account is wholly impractical for me. At the same time, my use of a mail client has created high expectations for what a mail client should be able to do, and every webmail service ever (SquirrelMail, RoundCube, Gmail's mail.google.com, etc.) just falls far woefully short of my expectations. However, webmail does have its use cases and I felt that webmail could support many of the things I wished it supported, existing webmail clients just weren't focused on those things. Thus, I decided to write my own webmail software and create the kind of webmail client that I wished had existed.

### Why is the webmail backend separate, and written in C, not PHP?

The main reason is performance. The fact is that **there are no good PHP IMAP libraries** (I spent some time experimenting, but feel free to try to prove me wrong). IDLE is not well supported among many PHP libraries, and even the ones that do have it simply don't allow it to be made use of in a meaningful way. The backend was, in fact, prototyped with a library that did support IDLE, but eventually this was abandoned in favor of a backend written in C. One reason for this is that the PHP library in question simply had a very poor interface for being able to make effective and efficient use of the IMAP protocol. This made it necessary to perform a much larger number of IMAP operations than is really necessary in theory. As a result, many operations were incredibly slow. After reimplementing existing functionaliy in C, using a C IMAP client library that was both effective and efficient, performance increased by orders of magnitude. Operations that took seconds in PHP took milliseconds in the C implementation. For this reason, although I originally planned to support multiple backends, a PHP implementation and a C implementation, the PHP implementation is so unusable that I have not pursued it further since developing the C version. If anyone would like the source included for somebody else to continue with, I can do that upon request.

Consequently, the frontend remains written in PHP, because PHP is just fine for that, but the backend (the part that actually interacts with the IMAP protocol) is written in C because I concluded it is impossible to write a reasonably good backend in PHP for a webmail client, at least with existing libraries. This may change in the future, but it doesn't appear likely for now.

Because the webmail backend is part of the [LBBS software](https://github.com/InterLinked1/lbbs), you'll also need to grab that and install it in order to make wssmail work. No configuration is required of the backend webmail module itself.

### Does wssmail support multiple accounts?

No, and this is true of pretty much all open source webmail clients as well. wssmail itself is completely stateless, essentially. When you log in to it, your credentials are sent directly to the IMAP server (though they are cached in session variables for sending mail and page reloads). There is no intermediary on which you have an account that could give you access to additional accounts.

If you want to use multiple accounts, consider some kind of IMAP proxy, e.g. setting up virtual/remote IMAP mailboxes in [LBBS](https://github.com/InterLinked1/lbbs). This will allow you to manage multiple IMAP accounts via a single IMAP connection, and the mail client itself is none the wiser about that.

### What does wssmail mean?

It is incredibly difficult to come up with a name for webmail software that is not already taken. The original idea for the name of this software was *idlemail*, due to its native support for RFC 2177 IMAP IDLE, but this name was already taken. Basically every other name I could think of was also already taken. The backend for this project uses WebSockets - in a particular, it depends on the [libwss](https://github.com/InterLinked1/libwss) library - and so at some point, wssmail become a working name for the project, and I still haven't come up with a better name, so for now, the name has stuck. `libwss` itself stands for WebSocket server library, and the backend of wssmail does use this library, but other than that, the name itself doesn't have too much relevance.

## Browser Support

wssmail should support most major and open source browsers from the past few years (although possibly not Internet Explorer; this is not tested). In particular, it includes Chromium version 70 (so at least the last 5 years of Chromium releases). wssmail does require WebSocket support, which not all older browsers support. JavaScript should be highly compatible with browsers from the past few years - if you encounter a compatibility issue, please report it.

## Contributions

Contributions are welcome. Please keep in mind that wssmail is intended to support a wide variety of browsers, both current and non-current, to the extent possible. All JavaScript is vanilla JavaScript (no jQuery, external libraries, etc.), and no incompatible operators are used. In particular, [**nullish coalescing and optional chaining are strictly forbidden in this codebase**](https://blog.interlinked.us/69/nullish-coalescing-and-optional-chaining). Additionally, wssmail is intentionally designed to be lightweight and bloat-free to support users with older browsers or who may be using slower connections, e.g. dial-up. Changes that break existing compatibility, if they could be done in a more compatible way, or add bloat, will also not be accepted.
