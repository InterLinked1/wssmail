var localSettings = [];

function getSetting(name) {
	return localStorage.getItem(name);
}

function setSetting(name, value) {
	console.log("Setting => " + name + "=" + value);
	localStorage.setItem(name, value);
}

function settingExists(setting) {
	/* IE11 doesn't support maps, so I think we need to do a linear time iteration of the entire array: */
	for (var i = 0; i < localSettings.length; i++) {
		var s = localSettings[i];
		if (s.setting === setting) {
			return true;
		}
	}
	return false;
}

function getDefaultSetting(setting) {
	/* IE11 doesn't support maps, so I think we need to do a linear time iteration of the entire array: */
	for (var i = 0; i < localSettings.length; i++) {
		var s = localSettings[i];
		if (s.setting === setting) {
			return s.defaultSetting;
		}
	}
	console.error("No such setting: " + setting);
}

function getBoolSetting(name) {
	var s = getSetting(name);
	if (s === undefined || s == null) {
		return getDefaultSetting(name);
	}
	return s === "true";
}

function setBoolSetting(name, value) {
	setSetting(name, (value ? "true" : "false"));
}

function getArraySetting(name) {
	var s = getSetting(name);
	if (s === undefined || s == null) {
		return [];
	}
	return JSON.parse(s);
}

function setArraySetting(name, value) {
	var s = JSON.stringify(value);
	setSetting(name, s);
}

function registerSetting(labelText, labelID, setting, defaultSetting) {
	if (settingExists(setting)) {
		console.error("Setting " + setting + " is already registered!");
		return;
	}
	localSettings.push({
		setting: setting,
		labelText: labelText,
		labelID: labelID,
		defaultSetting: defaultSetting
	});
}

/* Settings require page reload are marked with a '*' */
registerSetting("Display labels in top menu, not icons*", 'force-labels', 'forcelabels', false);
registerSetting("Automark read when deleting/junking a message", 'automark-seen', 'automarkseen', true);
