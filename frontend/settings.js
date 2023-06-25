function getSetting(name) {
	return localStorage.getItem(name);
}

function setSetting(name, value) {
	console.log("Setting => " + name + "=" + value);
	localStorage.setItem(name, value);
}

function getBoolSetting(name) {
	var s = getSetting(name);
	if (s === undefined || s == null) {
		return false;
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
