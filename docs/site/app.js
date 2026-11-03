(() => {
  "use strict";

  const pages = Array.isArray(window.DOCS) ? window.DOCS : [];
  const article = document.getElementById("article");
  const navigation = document.getElementById("navigation");
  const toc = document.getElementById("toc");
  const dialog = document.getElementById("search-dialog");
  const searchInput = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  const sidebar = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menu-toggle");
  let activePage = null;
  let headingObserver = null;
  let searchOrigin = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function route(id, heading) {
    return `#/${encodeURIComponent(id)}${heading ? `/${encodeURIComponent(heading)}` : ""}`;
  }

  function closeMenu() {
    sidebar.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }

  function buildNavigation() {
    const groups = [...new Set(pages.map((page) => page.group))];
    groups.forEach((group) => {
      const section = element("div", "nav-group");
      section.append(element("div", "nav-group-title", group));
      pages
        .filter((page) => page.group === group)
        .forEach((page) => {
          const link = element("a", "nav-link");
          link.href = route(page.id);
          link.dataset.page = page.id;
          link.append(
            element(
              "span",
              "nav-link-number",
              String(pages.indexOf(page) + 1).padStart(2, "0"),
            ),
          );
          link.append(element("span", "", page.navTitle || page.title));
          section.append(link);
        });
      navigation.append(section);
    });
  }

  function prepareHeadings(page) {
    toc.replaceChildren();
    const headings = [...article.querySelectorAll("h2, h3")];
    headings.forEach((heading, index) => {
      if (!heading.id) heading.id = `section-${index + 1}`;
      const title = heading.textContent;
      const link = element(
        "a",
        `toc-link${heading.tagName === "H3" ? " subheading" : ""}`,
        title,
      );
      link.href = route(page.id, heading.id);
      link.dataset.heading = heading.id;
      toc.append(link);
      if (heading.closest("a")) return;
      const anchor = element("a", "heading-anchor", "#");
      anchor.href = link.href;
      anchor.setAttribute("aria-label", `Link para ${title}`);
      heading.append(anchor);
    });
    if (headingObserver) headingObserver.disconnect();
    headingObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (!visible) return;
        toc
          .querySelectorAll("a")
          .forEach((link) =>
            link.classList.toggle(
              "active",
              link.dataset.heading === visible.target.id,
            ),
          );
      },
      { rootMargin: "-95px 0px -65% 0px" },
    );
    headings.forEach((heading) => headingObserver.observe(heading));
  }

  function prepareCode() {
    article.querySelectorAll("pre").forEach((pre) => {
      pre.tabIndex = 0;
      const code = pre.querySelector("code");
      if (!code) return;
      const button = element("button", "copy-code", "Copiar");
      button.type = "button";
      button.setAttribute("aria-label", "Copiar bloco de código");
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(code.textContent);
          button.textContent = "Copiado ✓";
          document.getElementById("announcement").textContent =
            "Código copiado.";
        } catch {
          button.textContent = "Selecione o código";
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(code);
          selection.removeAllRanges();
          selection.addRange(range);
          document.getElementById("announcement").textContent =
            "Cópia automática indisponível. Código selecionado; use o comando de copiar do navegador.";
        }
        window.setTimeout(() => {
          button.textContent = "Copiar";
        }, 2400);
      });
      pre.append(button);
    });
  }

  function prepareTables() {
    article.querySelectorAll("table").forEach((table) => {
      if (table.parentElement.classList.contains("table-wrap")) return;
      const wrapper = element("div", "table-wrap");
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "region");
      wrapper.setAttribute(
        "aria-label",
        "Tabela; role horizontalmente para ver todas as colunas",
      );
      table.replaceWith(wrapper);
      wrapper.append(table);
    });
  }

  function buildPager(page) {
    const pager = document.getElementById("page-navigation");
    pager.replaceChildren();
    const index = pages.indexOf(page);
    [
      { page: pages[index - 1], direction: "previous", label: "← Anterior" },
      { page: pages[index + 1], direction: "next", label: "Próxima →" },
    ].forEach((item) => {
      if (!item.page) return;
      const link = element("a", item.direction);
      link.href = route(item.page.id);
      link.append(
        element("small", "", item.label),
        element("span", "", item.page.title),
      );
      pager.append(link);
    });
  }

  function parseLocation() {
    try {
      const [id, heading] = window.location.hash
        .replace(/^#\/?/, "")
        .split("/")
        .map(decodeURIComponent);
      return { id, heading };
    } catch {
      return { id: "", heading: "" };
    }
  }

  function render() {
    closeMenu();
    const { id, heading } = parseLocation();
    const page =
      pages.find((item) => item.id === id) || (!id ? pages[0] : null);
    if (!page) {
      article.innerHTML =
        '<h1 id="page-title">Página não encontrada</h1><p>Este endereço não corresponde a uma página da documentação.</p><p><a href="#/">Voltar ao início →</a></p>';
      activePage = null;
      toc.replaceChildren();
      document.getElementById("page-navigation").replaceChildren();
      document.getElementById("breadcrumb").replaceChildren();
      document.title = "Página não encontrada · Smart Harness";
      closeMenu();
      return;
    }
    if (activePage !== page.id) {
      activePage = page.id;
      article.replaceChildren(element("h1", "", page.title));
      article.firstElementChild.id = "page-title";
      if (page.description)
        article.append(element("p", "page-description", page.description));
      const content = element("div", "page-content");
      content.innerHTML = page.html;
      article.append(content);
      const breadcrumb = document.getElementById("breadcrumb");
      breadcrumb.replaceChildren(
        element("span", "", page.group),
        element("span", "breadcrumb-separator", "/"),
        element("span", "", page.title),
      );
      document.title = `${page.title} · Smart Harness`;
      navigation.querySelectorAll("a").forEach((link) => {
        const selected = link.dataset.page === page.id;
        link.classList.toggle("active", selected);
        if (selected) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
      prepareHeadings(page);
      prepareCode();
      prepareTables();
      buildPager(page);
      closeMenu();
      if (!heading) window.scrollTo({ top: 0, behavior: "instant" });
    }
    if (heading)
      requestAnimationFrame(() => {
        const target = document.getElementById(heading);
        if (target && article.contains(target))
          target.scrollIntoView({ block: "start" });
      });
  }

  function plainText(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.textContent.replace(/\s+/g, " ").trim();
  }

  function normalize(text) {
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  }

  const searchIndex = pages.map((page) => ({
    page,
    text: plainText(page.html),
    query: normalize(
      `${page.title} ${page.description} ${plainText(page.html)}`,
    ),
  }));

  function search() {
    const query = normalize(searchInput.value.trim());
    const words = query.split(/\s+/).filter(Boolean);
    const matches = searchIndex.filter((item) =>
      words.every((word) => item.query.includes(word)),
    );
    results.replaceChildren();
    document.getElementById("search-status").textContent = query
      ? `${matches.length} ${matches.length === 1 ? "página encontrada" : "páginas encontradas"}`
      : "Explore os guias ou digite para buscar no conteúdo.";
    if (matches.length === 0) {
      results.append(
        element(
          "p",
          "empty-state",
          "Nenhum resultado. Tente outro termo, como CLI, token ou marketplace.",
        ),
      );
      return;
    }
    matches.forEach(({ page, text }) => {
      const link = element("a", "search-result");
      link.href = route(page.id);
      const match = query ? normalize(text).indexOf(words[0]) : -1;
      const start = match > 80 ? match - 65 : 0;
      const excerpt =
        query && match >= 0
          ? `${start ? "…" : ""}${text.slice(start, start + 170)}…`
          : page.description;
      link.append(
        element("small", "", page.group),
        element("strong", "", page.title),
        element("p", "", excerpt),
      );
      link.addEventListener("click", () => {
        dialog.close();
        requestAnimationFrame(() =>
          document.getElementById("main").focus({ preventScroll: true }),
        );
      });
      results.append(link);
    });
  }

  function openSearch() {
    if (dialog.open) return;
    searchOrigin = document.activeElement;
    searchInput.value = "";
    search();
    dialog.showModal();
    searchInput.focus();
  }

  document.getElementById("open-search").addEventListener("click", openSearch);
  document
    .getElementById("close-search")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (searchOrigin instanceof HTMLElement) searchOrigin.focus();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close();
  });
  searchInput.addEventListener("input", search);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.open) {
      event.preventDefault();
      dialog.close();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
    if (event.key === "Escape" && sidebar.classList.contains("open")) {
      closeMenu();
      menuToggle.focus();
    }
  });
  menuToggle.addEventListener("click", () => {
    const opened = sidebar.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(opened));
  });
  article.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    const href = link.getAttribute("href");
    if (href && href.startsWith("#") && !href.startsWith("#/") && activePage) {
      event.preventDefault();
      window.location.hash = route(activePage, href.slice(1));
    }
  });
  document.querySelector(".skip-link").addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("main").focus();
  });
  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      closeMenu();
      requestAnimationFrame(() =>
        document.getElementById("main").focus({ preventScroll: true }),
      );
    }
  });
  window.addEventListener("hashchange", render);
  buildNavigation();
  render();
})();
