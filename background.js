// ==================== background.js ====================
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab?.id) return;

    // 注入脚本获取页面真实URL
    const pageInfo = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        actualUrl: window.location.href,
        isPdf: document.contentType === "application/pdf",
      }),
    });

    const { actualUrl, isPdf } = pageInfo[0]?.result || {};

    // 处理本地PDF的特殊情况
    if (isPdf || isLocalPdfFile(actualUrl)) {
      await handlePdfDocument(actualUrl, tab.id);
      return;
    }

    // 处理普通页面的PDF链接扫描
    const links = await findPdfLinksInPage(tab.id);
    handlePdfLinks(links, tab.id);
  } catch (error) {
    // console.error('扩展错误:', error);
    showNotification(chrome.i18n.getMessage("noPdfLinks"), tab.id);
  }
});

// ==================== 核心功能函数 ====================
async function handlePdfDocument(pdfUrl, tabId) {
  try {
    await chrome.windows.create({
      url: pdfUrl,
      type: "popup",
      state: "fullscreen",
    });
  } catch (error) {
    console.error("打开窗口失败:", error);
    showNotification(chrome.i18n.getMessage("openPdfFailed"), tabId);
  }

  // 关闭原始标签页（可选）
  if (tabId) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (error) {
      console.warn("关闭标签页失败:", error);
    }
  }
}

// ==================== 工具函数 ====================
function isLocalPdfFile(url) {
  return url.startsWith("file://") && isPdfUrl(url);
}

async function findPdfLinksInPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 同时检测<a>标签和嵌入的PDF
        const linkPDFs = Array.from(document.links)
          .filter((link) => link.href.match(/\.pdf(\?|#|$)/i))
          .map((link) => ({
            url: link.href,
            title: link.textContent.trim().slice(0, 40),
          }));

        // 检测embed和object标签
        const embeddedPDFs = Array.from(
          document.querySelectorAll(
            'embed[type="application/pdf"], object[type="application/pdf"]'
          )
        ).map((el) => ({
          url: el.src || el.data,
          title: "embedded PDF",
        }));

        return [...linkPDFs, ...embeddedPDFs];
      },
    });
    return results[0]?.result || [];
  } catch (error) {
    console.warn("页面扫描失败:", error);
    return [];
  }
}

function handlePdfLinks(links, tabId) {
  if (links.length === 0) {
    showNotification(chrome.i18n.getMessage("noPdfLinks"), tabId);
    return;
  }

  if (links.length === 1) {
    handlePdfDocument(links[0].url, tabId);
  } else {
    createPdfSelectionMenu(links, tabId);
  }
}

function createPdfSelectionMenu(links, tabId) {
  chrome.contextMenus.removeAll(() => {
    links.forEach((link, index) => {
      chrome.contextMenus.create({
        id: `pdf_${index}`,
        title: `📄 ${link.title}`,
        contexts: ["action"],
      });
    });

    const menuClickHandler = (info) => {
      const index = parseInt(info.menuItemId.split("_")[1], 10);
      if (!isNaN(index) && links[index]) {
        handlePdfDocument(links[index].url, tabId);
      }
      chrome.contextMenus.removeAll();
      chrome.contextMenus.onClicked.removeListener(menuClickHandler);
    };

    chrome.contextMenus.onClicked.addListener(menuClickHandler);
  });
}

// ==================== 辅助函数 ====================
function isPdfUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".pdf") || /\.pdf(\?|#|$)/i.test(url);
  } catch {
    return false;
  }
}

function showNotification(message, tabId) {
  // 优先页面内弹窗，失败时回退系统通知
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (message, title) => {
      const popup = document.createElement("div");
      popup.style.position = "fixed";
      popup.style.top = "20px";
      popup.style.right = "20px";
      popup.style.padding = "12px 16px";
      popup.style.backgroundColor = "#f5f5f5";
      popup.style.borderRadius = "8px";
      popup.style.boxShadow = "0 5px 15px rgba(0, 0, 0, 0.65)";
      popup.style.zIndex = "999999";
      popup.style.maxWidth = "300px";
      popup.style.fontFamily = "Arial, sans-serif";
      const titleEl = document.createElement("div");
      titleEl.textContent = title;
      titleEl.style.fontWeight = "bold";
      titleEl.style.marginBottom = "8px";
      titleEl.style.color = "#1a73e8";
      const messageEl = document.createElement("div");
      messageEl.textContent = message;
      messageEl.style.color = "#202124";
      const icon = document.createElement("img");
      icon.src = chrome.runtime.getURL("./icons/icon128.png");
      icon.style.width = "48px";
      icon.style.height = "48px";
      icon.style.marginRight = "12px";
      icon.style.float = "left";
      popup.appendChild(icon);
      popup.appendChild(titleEl);
      popup.appendChild(messageEl);
      document.body.appendChild(popup);
      setTimeout(() => {
        popup.style.opacity = "0";
        popup.style.transition = "opacity 0.3s";
        setTimeout(() => popup.remove(), 300);
      }, 3000);
    },
    args: [message, chrome.i18n.getMessage("extensionName")],
  }, (results) => {
    // 如果注入失败或被 CSP 拦截，则回退为系统通知
    if (chrome.runtime.lastError || !results || results.length === 0 || results[0].result === undefined) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: chrome.i18n.getMessage("extensionName"),
        message: message
      });
    }
  });
}
