
function addBoolSetting(container, labelText, labelID, setting) {
	var div = document.createElement('div');
	var label = document.createElement('label');
	var div2 = document.createElement('div');
	label.innerHTML = labelText;
	div.appendChild(label);
	div.appendChild(div2);

	var currentSetting = getBoolSetting(setting);

	var input1 = document.createElement('input');
	input1.setAttribute('type', 'radio');
	input1.setAttribute('id', labelID + '-1');
	input1.setAttribute('name', labelID);
	input1.checked = currentSetting;
	input1.addEventListener('click',  function(e) { setBoolSetting(setting, true); }, {passive: true});

	var label1 = document.createElement('label');
	label1.setAttribute('for', labelID + '-1');
	label1.textContent = 'Enabled';
	div2.appendChild(input1);
	div2.appendChild(label1);

	var input2 = document.createElement('input');
	input2.setAttribute('type', 'radio');
	input2.setAttribute('id', labelID + '-2');
	input2.setAttribute('name', labelID);
	input2.checked = !currentSetting;
	input2.addEventListener('click',  function(e) { setBoolSetting(setting, false); }, {passive: true});

	var label2 = document.createElement('label');
	label2.setAttribute('for', labelID + '-2');
	label2.textContent = 'Disabled';
	div2.appendChild(input2);
	div2.appendChild(label2);

	container.appendChild(div);
}

function displaySettings() {
	var c = document.getElementById('manage-local-settings');
	addBoolSetting(c, "Force Labels - Display labels, not icons", 'force-labels', 'forcelabels');
	/* Identities */
	displayIdentities();
	console.log(document.getElementById('add-identity'));
	document.getElementById('add-identity').addEventListener('click', function(e) { setIdentity(true); }, {passive: true});
	document.getElementById('remove-identity').addEventListener('click', function(e) { setIdentity(false); }, {passive: true});
}

function displayIdentities() {
	var idents = getArraySetting('identities');
	document.getElementById('existing-identities').innerHTML = '';
	for (i = 0; i < idents.length; i++) {
		var ident = document.createElement('p');
		ident.textContent = idents[i];
		document.getElementById('existing-identities').appendChild(ident);
	}
}

function setIdentity(add) {
	var ident = document.getElementById('identity-tbox').value;
	if (ident.length < 1) {
		remove;
	}
	var idents = getArraySetting('identities');
	if (add) {
		idents.push(ident);
	} else {
		/* Remove all */
		for (i = 0; i < idents.length; i++) {
			if (idents[i] === ident) {
				idents.splice(i, 1);
				break;
			}
		}
	}
	setArraySetting('identities', idents);
	displayIdentities();
}
