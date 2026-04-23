// this might trigger a bunch of superfluous sync.set directly after
// installation - but that's probably not worth bothering with.
document.querySelectorAll("input").forEach(function(input: HTMLInputElement) {
  input.addEventListener("change", function() {
    var key = input.id;
    var type = input.type;
    var value: boolean | string;

    if (type === "checkbox") {
      value = input.checked;
    } else {
      value = input.value;
    }

    chrome.runtime.sendMessage({action: "option", key: key, value: value});
    chrome.storage.sync.set({[key]: value});
  });
});

function restoreOptions(): void {
  document.querySelectorAll("input").forEach(function(input: HTMLInputElement) {
    var key = input.id;
    var type = input.type;
    var value: boolean | string = false;

    chrome.storage.sync.get(key, function(setting) {
      if (Object.keys(setting).length) {
        value = setting[key];
        if (type === "checkbox") {
          input.checked = value as boolean;
        } else {
          input.value = value as string;
        }
      } else {
        chrome.storage.sync.set({[key]: value});
      }
      chrome.runtime.sendMessage({action: "option", key: key, value: value});
    });
  });
}

document.addEventListener("DOMContentLoaded", restoreOptions);
