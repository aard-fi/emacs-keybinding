// this might trigger a bunch of superfluous sync.set directly after
// installation - but that's probably not worth bothering with.
type OptionElement = HTMLInputElement | HTMLSelectElement;

document.querySelectorAll<OptionElement>("input, select").forEach(function(element) {
  element.addEventListener("change", function() {
    var key = element.id;
    var value: boolean | string;

    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      value = element.checked;
    } else {
      value = element.value;
    }

    chrome.runtime.sendMessage({action: "option", key: key, value: value});
    chrome.storage.sync.set({[key]: value});
  });
});

function restoreOptions(): void {
  document.querySelectorAll<OptionElement>("input, select").forEach(function(element) {
    var key = element.id;
    var value: boolean | string = false;

    chrome.storage.sync.get(key, function(setting) {
      if (Object.keys(setting).length) {
        value = setting[key];
        if (element instanceof HTMLInputElement && element.type === "checkbox") {
          element.checked = value as boolean;
        } else {
          element.value = value as string;
        }
      } else {
        chrome.storage.sync.set({[key]: value});
      }
      chrome.runtime.sendMessage({action: "option", key: key, value: value});
    });
  });
}

document.addEventListener("DOMContentLoaded", restoreOptions);
