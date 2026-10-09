(() => {
  'use strict';

  const STORAGE_KEY = 'florDePagina.library.v1';
  const THEME_KEY = 'florDePagina.theme';
  const SEED_VERSION_KEY = 'florDePagina.defaultsSeeded.v2';
  const HANDLE_DB = 'florDePagina.fileHandles';
  const HANDLE_STORE = 'handles';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let books = [];
  let editingId = null;
  let currentCover = '';
  let activeNavStatus = '';
  let linkedFileHandle = null;
  let fileSyncTimer = null;
  let fileWriteQueue = Promise.resolve();
  let dbPromise = null;
  let toastTimerId = 0;
  let backdropHideTimer = 0;
  let swipeStart = null;

  const sidebar = $('#sidebar');
  const mobileMenuToggle = $('#mobile-menu-toggle');
  const sidebarBackdrop = $('#sidebar-backdrop');
  const editorModal = $('#editor-modal');
  const detailModal = $('#detail-modal');
  const helpModal = $('#help-modal');
  const bookForm = $('#book-form');
  const coverInput = $('#cover-input');
  const coverPreview = $('#cover-preview');
  const coverPlaceholder = $('#cover-placeholder');
  const saveIndicator = $('#save-indicator');
  const saveText = $('#save-text');

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function makeId() {
    return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `book-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function cleanCover(value) {
    if (typeof value !== 'string') return '';
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)) return value;
    // Capas predefinidas do projeto ficam na pasta local covers/.
    if (/^covers\/[a-zA-Z0-9_-]+\.jpg$/i.test(value)) return value;
    return '';
  }

  function normalizeBook(raw = {}) {
    const now = new Date().toISOString();
    const genreValues = Array.isArray(raw.genres) ? raw.genres : (typeof raw.genres === 'string' ? raw.genres.split(/[,;\n]/) : []);
    const characters = Array.isArray(raw.characters) ? raw.characters : [];
    const ratingNumber = Number(raw.rating);
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
      title: String(raw.title ?? raw.nome ?? '').trim().slice(0, 180),
      author: String(raw.author ?? raw.autor ?? '').trim().slice(0, 120),
      synopsis: String(raw.synopsis ?? raw.sinopse ?? '').slice(0, 6000),
      genres: [...new Set(genreValues.map(g => String(g).trim()).filter(Boolean).map(g => g.slice(0, 60)))],
      characters: characters.map(character => ({
        name: String(character?.name ?? character?.nome ?? '').trim().slice(0, 120),
        description: String(character?.description ?? character?.resumo ?? character?.summary ?? '').trim().slice(0, 1200)
      })).filter(character => character.name || character.description).slice(0, 30),
      cover: cleanCover(raw.cover ?? raw.coverData ?? raw.capa ?? ''),
      status: ['Biblioteca', 'Quero ler', 'Lendo', 'Lido', 'Pausado', 'Abandonado'].includes(raw.status) ? raw.status : 'Biblioteca',
      rating: Number.isFinite(ratingNumber) ? Math.min(5, Math.max(0, Math.round(ratingNumber))) : 0,
      favorite: raw.favorite === true || raw.favorite === 'true',
      comments: String(raw.comments ?? raw.comentarios ?? '').slice(0, 6000),
      notes: String(raw.notes ?? raw.anotacoes ?? '').slice(0, 6000),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
    };
  }

  function parseLibrary(data) {
    const list = Array.isArray(data) ? data : data?.books;
    if (!Array.isArray(list)) throw new Error('Este JSON não parece ser uma biblioteca válida. Era esperado um array "books".');
    const normalized = list.map(normalizeBook).filter(book => book.title);
    return normalized;
  }

  function payloadForExport() {
    return {
      schemaVersion: 1,
      app: 'Flor de Página',
      updatedAt: new Date().toISOString(),
      bookCount: books.length,
      books
    };
  }

  function setSaveState(state, message) {
    saveIndicator.classList.remove('pending', 'error');
    if (state === 'pending') saveIndicator.classList.add('pending');
    if (state === 'error') saveIndicator.classList.add('error');
    saveText.textContent = message;
  }

  function toast(message, type = 'success', duration = 3600) {
    const region = $('#toast-region');
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    region.append(node);
    window.setTimeout(() => node.remove(), duration);
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      if (!('indexedDB' in window)) return resolve(null);
      const request = indexedDB.open(HANDLE_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return dbPromise;
  }

  async function storeFileHandle(handle) {
    const db = await openDB();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).put(handle, 'linkedJson');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    });
  }

  async function getStoredFileHandle() {
    const db = await openDB();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(HANDLE_STORE, 'readonly');
        const request = tx.objectStore(HANDLE_STORE).get('linkedJson');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async function readHandleLibrary(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    if (!text.trim()) return [];
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('O arquivo selecionado não contém JSON válido.'); }
    return parseLibrary(data);
  }

  function setTheme(theme) {
    const dark = theme === 'dark';
    document.body.classList.toggle('dark', dark);
    $('#theme-icon').textContent = dark ? '☀' : '☾';
    $('#theme-toggle').setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo escuro');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#19151c' : '#fff2f7');
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* preferência visual opcional */ }
  }

  function loadLocalBooks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return parseLibrary(JSON.parse(raw));
    } catch (error) {
      console.error('Não foi possível carregar os dados locais:', error);
      toast('Não consegui ler a biblioteca local. Importe um backup JSON para restaurá-la.', 'error', 6000);
      return [];
    }
  }

  function saveLocalBooks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, books }));
      return true;
    } catch (error) {
      console.error('Falha ao salvar no navegador:', error);
      setSaveState('error', 'Armazenamento local cheio');
      toast('O navegador ficou sem espaço para salvar. Vincule um JSON ou exporte os dados e reduza o tamanho das capas.', 'error', 6500);
      return false;
    }
  }

  async function writeLinkedFileNow() {
    if (!linkedFileHandle) return;
    fileWriteQueue = fileWriteQueue.then(async () => {
      if (!linkedFileHandle) return;
      const permission = await linkedFileHandle.queryPermission?.({ mode: 'readwrite' });
      if (permission && permission !== 'granted') {
        setSaveState('pending', 'Autorize novamente o arquivo JSON');
        return;
      }
      const writable = await linkedFileHandle.createWritable();
      await writable.write(JSON.stringify(payloadForExport(), null, 2));
      await writable.close();
      setSaveState('saved', 'Sincronizado com JSON');
    }).catch(error => {
      console.error('Falha ao sincronizar arquivo JSON:', error);
      setSaveState('error', 'Falha ao salvar no JSON');
      toast('Não consegui atualizar o arquivo JSON vinculado. Confira as permissões e vincule-o novamente.', 'error', 6500);
    });
    return fileWriteQueue;
  }

  function scheduleFileSync() {
    if (!linkedFileHandle) return;
    clearTimeout(fileSyncTimer);
    setSaveState('pending', 'Salvando no arquivo JSON…');
    fileSyncTimer = window.setTimeout(() => { writeLinkedFileNow(); }, 350);
  }

  function persistBooks() {
    const saved = saveLocalBooks();
    if (saved && !linkedFileHandle) setSaveState('saved', 'Salvo neste navegador');
    scheduleFileSync();
    render();
  }

  async function restoreLinkedHandle() {
    const handle = await getStoredFileHandle();
    if (!handle) return;
    try {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        setSaveState('pending', 'JSON vinculado: reconecte para sincronizar');
        return;
      }
      linkedFileHandle = handle;
      const fileBooks = await readHandleLibrary(handle);
      if (fileBooks.length || books.length === 0) books = fileBooks;
      saveLocalBooks();
      setSaveState('saved', 'Sincronizado com JSON');
      if (!fileBooks.length && books.length) await writeLinkedFileNow();
    } catch (error) {
      console.warn('O último JSON não pôde ser reaberto:', error);
      linkedFileHandle = null;
      setSaveState('pending', 'JSON disponível para reconexão');
    }
  }

  async function connectJSON() {
    if (typeof window.showOpenFilePicker !== 'function') {
      toast('Este navegador não oferece vínculo automático de arquivos. Use Exportar JSON e importe o arquivo quando precisar.', 'warning', 6000);
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'Arquivo JSON da biblioteca', accept: { 'application/json': ['.json'] } }]
      });
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        toast('A permissão de gravação não foi concedida. A biblioteca continua salva neste navegador.', 'warning', 5000);
        return;
      }
      const file = await handle.getFile();
      let fileBooks = [];
      if (file.size > 0) fileBooks = await readHandleLibrary(handle);
      if (fileBooks.length > 0 && books.length > 0) {
        const useFile = window.confirm(`O arquivo selecionado contém ${fileBooks.length} livro(s) e esta biblioteca contém ${books.length}.\n\nOK: carregar os livros do arquivo JSON (substitui a biblioteca atual).\nCancelar: manter esta biblioteca e gravá-la no arquivo.`);
        if (useFile) books = fileBooks;
      } else if (fileBooks.length > 0) {
        books = fileBooks;
      }
      linkedFileHandle = handle;
      await storeFileHandle(handle);
      saveLocalBooks();
      await writeLinkedFileNow();
      render();
      toast('Arquivo JSON vinculado! As próximas alterações serão sincronizadas automaticamente.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error(error);
      toast(error?.message || 'Não foi possível vincular esse arquivo JSON.', 'error', 6000);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportJSON() {
    const date = new Date().toISOString().slice(0, 10);
    const data = JSON.stringify(payloadForExport(), null, 2);
    downloadBlob(new Blob([data], { type: 'application/json;charset=utf-8' }), `biblioteca-livros-${date}.json`);
    toast('Backup JSON preparado para baixar.');
  }

  async function importJSONFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = parseLibrary(parsed);
      if (!window.confirm(`O arquivo contém ${imported.length} livro(s). A importação vai substituir a biblioteca atual (${books.length} livro(s)). Deseja continuar?`)) return;
      books = imported;
      persistBooks();
      toast(`${books.length} livro(s) importado(s) com sucesso.`);
    } catch (error) {
      toast(error?.message || 'Não consegui importar o JSON. Confira o arquivo e tente novamente.', 'error', 6000);
    } finally {
      $('#import-file-input').value = '';
    }
  }

  function formatDate(value) {
    if (!value) return 'Adicionado recentemente';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Adicionado recentemente';
    return `Atualizado ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')}`;
  }

  function getBookById(id) { return books.find(book => book.id === id); }

  function comparableTitle(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9]/g, '');
  }

  function mergeDefaultBooksOnce() {
    if (!Array.isArray(window.FDP_DEFAULT_BOOKS)) return;

    let alreadySeeded = false;
    try {
      alreadySeeded = localStorage.getItem(SEED_VERSION_KEY) === '1';
    } catch {
      // Se localStorage estiver indisponível, mesclamos em memória nesta sessão.
    }

    if (alreadySeeded) return;

    const defaults = parseLibrary(window.FDP_DEFAULT_BOOKS);
    const existingByTitle = new Map(
      books.map(book => [comparableTitle(book.title), book])
    );
    let changed = false;

    for (const defaultBook of defaults) {
      const key = comparableTitle(defaultBook.title);
      const existing = existingByTitle.get(key);

      if (!existing) {
        books.push(defaultBook);
        existingByTitle.set(key, defaultBook);
        changed = true;
        continue;
      }

      // Em bibliotecas da versão anterior, complementa autor/capa sem apagar dados pessoais.
      if (!existing.author && defaultBook.author) {
        existing.author = defaultBook.author;
        changed = true;
      }
      if (!existing.cover && defaultBook.cover) {
        existing.cover = defaultBook.cover;
        changed = true;
      }
      // Migra os títulos padrão antigos de 'Quero ler' para a estante neutra.
      if (existing.status === 'Quero ler' && defaultBook.status === 'Biblioteca' && !existing.rating && !existing.comments && !existing.notes) {
        existing.status = 'Biblioteca';
        changed = true;
      }
      // Preenche sinopse/personagens apenas quando a ficha local ainda está vazia.
      if (!existing.synopsis && defaultBook.synopsis) { existing.synopsis = defaultBook.synopsis; changed = true; }
      if ((!existing.characters || existing.characters.length === 0) && defaultBook.characters?.length) { existing.characters = defaultBook.characters; changed = true; }
    }

    if (changed) saveLocalBooks();

    try {
      localStorage.setItem(SEED_VERSION_KEY, '1');
    } catch {
      // Os dados padrão continuam visíveis mesmo sem persistência local.
    }
  }

  function allGenres() {
    return [...new Set(books.flatMap(book => book.genres))].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }

  function renderGenreFilter() {
    const select = $('#genre-filter');
    const current = select.value;
    const genres = allGenres();
    select.innerHTML = '<option value="">Todos os gêneros</option>' + genres.map(genre => `<option value="${escapeHTML(genre)}">${escapeHTML(genre)}</option>`).join('');
    if (genres.includes(current)) select.value = current;
  }

  function renderStats() {
    $('#stat-total').textContent = books.length;
    $('#nav-total').textContent = books.length;
    $('#stat-want').textContent = books.filter(book => book.status === 'Biblioteca').length;
    const wantLabel = document.querySelector('.stat-lilac .stat-label, .stat-lilac span');
    if (wantLabel) wantLabel.textContent = 'Biblioteca';
    const ratings = books.filter(book => book.rating > 0).map(book => book.rating);
    $('#stat-rating').textContent = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
  }

  function bookMatchesSearch(book, query) {
    if (!query) return true;
    const searchable = [book.title, book.author, book.synopsis, ...book.genres, ...book.characters.flatMap(c => [c.name, c.description]), book.comments, book.notes].join(' ').toLocaleLowerCase('pt-BR');
    return searchable.includes(query.toLocaleLowerCase('pt-BR'));
  }

  function filteredBooks() {
    const query = $('#search-input').value.trim();
    const genre = $('#genre-filter').value;
    const status = $('#status-filter').value || activeNavStatus;
    const sort = $('#sort-select').value;
    const result = books.filter(book => bookMatchesSearch(book, query) && (!genre || book.genres.some(item => item.toLocaleLowerCase('pt-BR') === genre.toLocaleLowerCase('pt-BR'))) && (!status || book.status === status));
    result.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });
      if (sort === 'author') return (a.author || '').localeCompare(b.author || '', 'pt-BR', { sensitivity: 'base' }) || a.title.localeCompare(b.title, 'pt-BR');
      if (sort === 'rating') return b.rating - a.rating || a.title.localeCompare(b.title, 'pt-BR');
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return result;
  }

  function statusClass(status) {
    if (status === 'Lido') return 'status-lido';
    if (status === 'Lendo') return 'status-lendo';
    return '';
  }

  function renderCard(book) {
    const cover = book.cover
      ? `<img class="card-cover" src="${book.cover}" alt="Capa de ${escapeHTML(book.title)}" loading="lazy">`
      : `<div class="cover-fallback"><span class="flower">✿</span><strong>${escapeHTML(book.title)}</strong><small>${escapeHTML(book.author || 'um livro da sua estante')}</small></div>`;
    const tags = book.genres.slice(0, 3).map(genre => `<span class="genre-tag">${escapeHTML(genre)}</span>`).join('');
    const extraTags = book.genres.length > 3 ? `<span class="genre-tag more-tag">+${book.genres.length - 3}</span>` : '';
    const rating = book.rating ? `<div class="rating-line"><span>${'★'.repeat(book.rating)}${'☆'.repeat(5 - book.rating)}</span><small>${book.rating}/5</small></div>` : `<div class="rating-line"><span>☆☆☆☆☆</span><small>Sem nota</small></div>`;
    const characterLabel = book.characters.length ? `${book.characters.length} personagem(ns)` : 'Ficha literária';
    return `<article class="book-card" data-book-id="${escapeHTML(book.id)}">
      <div class="card-cover-wrap" data-action="details" data-id="${escapeHTML(book.id)}" role="button" tabindex="0" aria-label="Ver detalhes de ${escapeHTML(book.title)}">
        ${cover}<span class="status-pill ${statusClass(book.status)}">${escapeHTML(book.status)}</span>${book.favorite ? '<span class="favorite-mark" title="Favorito">♡</span>' : ''}
      </div>
      <div class="card-body"><div class="card-author">${escapeHTML(book.author || 'Autor não informado')}</div><h3 class="card-title" data-action="details" data-id="${escapeHTML(book.id)}" tabindex="0">${escapeHTML(book.title)}</h3>${rating}
      <p class="card-synopsis">${escapeHTML(book.synopsis || 'Ainda não há uma sinopse registrada para este livro.')}</p><div class="genre-tags">${tags}${extraTags}</div>
      <div class="card-footer"><span class="card-meta" title="${escapeHTML(characterLabel)}">${escapeHTML(characterLabel)}</span><div class="card-actions"><button class="card-action" type="button" data-action="edit" data-id="${escapeHTML(book.id)}" aria-label="Editar ${escapeHTML(book.title)}" title="Editar">✎</button><button class="card-action" type="button" data-action="delete" data-id="${escapeHTML(book.id)}" aria-label="Excluir ${escapeHTML(book.title)}" title="Excluir">×</button></div></div></div>
    </article>`;
  }

  function renderActiveFilters() {
    const host = $('#active-filters');
    const chips = [];
    if ($('#search-input').value.trim()) chips.push(['search', `Busca: ${$('#search-input').value.trim()}`]);
    if ($('#genre-filter').value) chips.push(['genre', `Gênero: ${$('#genre-filter').value}`]);
    const status = $('#status-filter').value || activeNavStatus;
    if (status) chips.push(['status', `Estante: ${status}`]);
    host.innerHTML = chips.map(([key, label]) => `<span class="filter-chip">${escapeHTML(label)} <button type="button" data-clear-filter="${key}" aria-label="Remover filtro">×</button></span>`).join('');
    host.hidden = chips.length === 0;
  }

  function render() {
    renderGenreFilter();
    renderStats();
    const filtered = filteredBooks();
    const grid = $('#book-grid');
    const empty = $('#empty-state');
    grid.innerHTML = filtered.map(renderCard).join('');
    const anyFilter = $('#search-input').value.trim() || $('#genre-filter').value || $('#status-filter').value || activeNavStatus;
    $('#results-count').textContent = filtered.length === books.length
      ? `${books.length} ${books.length === 1 ? 'livro na estante' : 'livros na estante'}`
      : `${filtered.length} de ${books.length} livros encontrados`;
    $('#list-heading').textContent = anyFilter ? 'Livros encontrados' : 'Sua estante';
    if (filtered.length === 0) {
      empty.classList.add('visible');
      if (books.length === 0) {
        $('#empty-title').textContent = 'Sua estante está esperando por você';
        $('#empty-description').textContent = 'Adicione seu primeiro livro e comece a guardar aqui suas histórias favoritas.';
        $('#empty-add').hidden = false;
      } else {
        $('#empty-title').textContent = 'Nenhum livro por aqui';
        $('#empty-description').textContent = 'Não encontrei livros com esses filtros. Tente mudar a busca ou limpar os filtros.';
        $('#empty-add').hidden = true;
      }
    } else {
      empty.classList.remove('visible');
    }
    renderActiveFilters();
    $$('.nav-item[data-status-filter]').forEach(button => button.classList.toggle('active', button.dataset.statusFilter === activeNavStatus));
    $('#nav-all').classList.toggle('active', !activeNavStatus && !$('#status-filter').value);
  }

  function resetForm() {
    bookForm.reset();
    editingId = null;
    currentCover = '';
    $('#editor-title').textContent = 'Adicionar um livro';
    $('#title-error').textContent = '';
    updateCoverPreview('');
    $('#characters-list').innerHTML = '';
  }

  function updateCoverPreview(dataUrl) {
    currentCover = dataUrl || '';
    if (currentCover) {
      coverPreview.src = currentCover;
      coverPreview.hidden = false;
      coverPlaceholder.hidden = true;
      $('#remove-cover').hidden = false;
    } else {
      coverPreview.removeAttribute('src');
      coverPreview.hidden = true;
      coverPlaceholder.hidden = false;
      $('#remove-cover').hidden = true;
      coverInput.value = '';
    }
  }

  function addCharacterRow(character = {}) {
    const row = document.createElement('div');
    row.className = 'character-row';
    row.innerHTML = `<input type="text" maxlength="120" class="character-name" placeholder="Nome do personagem" aria-label="Nome do personagem" value="${escapeHTML(character.name || '')}"><textarea maxlength="1200" class="character-description" placeholder="Quem é? Um mini resumo..." aria-label="Mini resumo do personagem">${escapeHTML(character.description || '')}</textarea><button class="remove-character" type="button" aria-label="Remover personagem" title="Remover personagem">×</button>`;
    $('#characters-list').append(row);
  }

  function openNewBook() {
    resetForm();
    addCharacterRow();
    editorModal.showModal();
    setTimeout(() => $('#book-title').focus(), 50);
  }

  function openEditBook(id) {
    const book = getBookById(id);
    if (!book) return;
    resetForm();
    editingId = book.id;
    $('#editor-title').textContent = 'Editar livro';
    $('#book-title').value = book.title;
    $('#book-author').value = book.author;
    $('#book-status').value = book.status;
    $('#book-genres').value = book.genres.join(', ');
    $('#book-rating').value = String(book.rating);
    $('#book-favorite').value = String(book.favorite);
    $('#book-synopsis').value = book.synopsis;
    $('#book-comments').value = book.comments;
    $('#book-notes').value = book.notes;
    updateCoverPreview(book.cover);
    if (book.characters.length) book.characters.forEach(addCharacterRow); else addCharacterRow();
    editorModal.showModal();
    setTimeout(() => $('#book-title').focus(), 50);
  }

  function saveBookFromForm(event) {
    event.preventDefault();
    const titleInput = $('#book-title');
    const title = titleInput.value.trim();
    if (!title) {
      $('#title-error').textContent = 'O título é obrigatório.';
      titleInput.focus();
      return;
    }
    $('#title-error').textContent = '';
    const existing = editingId ? getBookById(editingId) : null;
    const genres = [...new Set($('#book-genres').value.split(/[,;\n]/).map(value => value.trim()).filter(Boolean))];
    const characters = $$('.character-row', $('#characters-list')).map(row => ({
      name: $('.character-name', row).value.trim(),
      description: $('.character-description', row).value.trim()
    })).filter(character => character.name || character.description);
    const now = new Date().toISOString();
    const book = normalizeBook({
      id: existing?.id || makeId(), title, author: $('#book-author').value.trim(),
      status: $('#book-status').value, genres, rating: Number($('#book-rating').value),
      favorite: $('#book-favorite').value === 'true', synopsis: $('#book-synopsis').value.trim(),
      characters, cover: currentCover, comments: $('#book-comments').value.trim(), notes: $('#book-notes').value.trim(),
      createdAt: existing?.createdAt || now, updatedAt: now
    });
    if (existing) books = books.map(item => item.id === existing.id ? book : item);
    else books.unshift(book);
    persistBooks();
    editorModal.close();
    toast(existing ? 'Livro atualizado com carinho ♡' : 'Livro adicionado à sua estante ♡');
  }

  function deleteBook(id) {
    const book = getBookById(id);
    if (!book) return;
    if (!window.confirm(`Excluir “${book.title}” da sua biblioteca? Essa ação não pode ser desfeita.`)) return;
    books = books.filter(item => item.id !== id);
    persistBooks();
    if (detailModal.open) detailModal.close();
    toast('Livro removido da estante.', 'warning');
  }

  function renderDetails(book) {
    const cover = book.cover
      ? `<img class="detail-cover" src="${book.cover}" alt="Capa de ${escapeHTML(book.title)}">`
      : '<div class="detail-cover-fallback" aria-hidden="true">✿</div>';
    const genres = book.genres.length ? book.genres.map(genre => `<span class="genre-tag">${escapeHTML(genre)}</span>`).join('') : '<span class="genre-tag">Sem gênero</span>';
    const rating = book.rating ? `${'★'.repeat(book.rating)}${'☆'.repeat(5 - book.rating)} · ${book.rating}/5` : 'Ainda não avaliado';
    const characters = book.characters.length ? `<div class="detail-characters">${book.characters.map(character => `<article class="detail-character"><strong>${escapeHTML(character.name || 'Personagem sem nome')}</strong><p>${escapeHTML(character.description || 'Sem descrição registrada.')}</p></article>`).join('')}</div>` : '<p>Nenhum personagem registrado ainda.</p>';
    $('#detail-content').innerHTML = `<div class="detail-hero">${cover}<div><div class="eyebrow"><span>✧</span> FICHA LITERÁRIA</div><h2 class="detail-title" id="detail-title">${escapeHTML(book.title)}</h2><p class="detail-author">${escapeHTML(book.author || 'Autor não informado')}</p><div class="detail-badges"><span class="status-pill ${statusClass(book.status)}">${escapeHTML(book.status)}</span>${book.favorite ? '<span class="genre-tag">♡ Favorito</span>' : ''}</div><div class="detail-badges">${genres}</div><div class="detail-rating">${escapeHTML(rating)}</div></div></div>
      <section class="detail-block"><h3>Sinopse</h3><p>${escapeHTML(book.synopsis || 'Nenhuma sinopse registrada.')}</p></section>
      <section class="detail-block"><h3>Personagens principais</h3>${characters}</section>
      <section class="detail-block"><h3>Comentários / resenha</h3><p>${escapeHTML(book.comments || 'Nenhum comentário registrado.')}</p></section>
      <section class="detail-block"><h3>Anotações pessoais</h3><p>${escapeHTML(book.notes || 'Nenhuma anotação registrada.')}</p></section>
      <div class="detail-actions"><button class="button button-primary" type="button" data-detail-action="edit" data-id="${escapeHTML(book.id)}">✎ Editar livro</button><button class="button button-outline" type="button" data-detail-action="delete" data-id="${escapeHTML(book.id)}">Excluir</button><span class="card-meta">${escapeHTML(formatDate(book.updatedAt))}</span></div>`;
    if (!detailModal.open) detailModal.showModal();
  }

  async function processCover(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      toast('Escolha uma imagem PNG, JPG, WEBP ou GIF.', 'warning');
      coverInput.value = '';
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast('A imagem original precisa ter menos de 15 MB.', 'warning');
      coverInput.value = '';
      return;
    }
    try {
      let bitmap;
      if ('createImageBitmap' in window) bitmap = await createImageBitmap(file);
      else {
        const tempUrl = URL.createObjectURL(file);
        bitmap = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => { URL.revokeObjectURL(tempUrl); resolve(image); };
          image.onerror = () => { URL.revokeObjectURL(tempUrl); reject(new Error('Imagem inválida')); };
          image.src = tempUrl;
        });
      }
      const maxWidth = 480, maxHeight = 720;
      const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (typeof bitmap.close === 'function') bitmap.close();
      updateCoverPreview(canvas.toDataURL('image/jpeg', 0.78));
      toast('Capa adicionada! Ela será compactada ao salvar.');
    } catch (error) {
      console.error(error);
      toast('Não consegui processar essa imagem. Tente outra capa.', 'error');
    }
  }

  function clearFilters() {
    $('#search-input').value = '';
    $('#genre-filter').value = '';
    $('#status-filter').value = '';
    activeNavStatus = '';
    render();
  }

  // Mobile navigation: button, backdrop, Escape key, and edge-swipe gestures.
  function isMobileSidebarLayout() {
    return window.matchMedia('(max-width: 680px)').matches;
  }
  function setMobileMenuOpen(open, restoreFocus = false) {
    if (!sidebar || !mobileMenuToggle || !sidebarBackdrop) return;
    const mobile = isMobileSidebarLayout();
    const shouldOpen = mobile && Boolean(open);
    window.clearTimeout(backdropHideTimer);
    document.body.classList.toggle('mobile-menu-open', shouldOpen);
    sidebar.setAttribute(
      'aria-hidden',
      String(mobile && !shouldOpen)
    );
    sidebar.inert = mobile && !shouldOpen;
    mobileMenuToggle.setAttribute(
      'aria-expanded',
      String(shouldOpen)
    );
    mobileMenuToggle.setAttribute(
      'aria-label',
      shouldOpen ? 'Fechar menu' : 'Abrir menu'
    );
    const menuIcon = $('#mobile-menu-icon');
    if (menuIcon) {
      menuIcon.textContent = shouldOpen ? '×' : '☰';
    }
    if (shouldOpen) {
      sidebarBackdrop.hidden = false;
      requestAnimationFrame(() => {
        sidebarBackdrop.classList.add('visible');
      });
    } else {
      sidebarBackdrop.classList.remove('visible');
      backdropHideTimer = window.setTimeout(() => {
        if (!document.body.classList.contains('mobile-menu-open')) {
          sidebarBackdrop.hidden = true;
        }
      }, 230);
    }
    if (restoreFocus && mobile) {
      mobileMenuToggle.focus({ preventScroll: true });
    }
  }
  function syncMobileSidebarMode() {
    if (!sidebar || !mobileMenuToggle || !sidebarBackdrop) return;
    const mobile = isMobileSidebarLayout();
    if (!mobile) {
      document.body.classList.remove('mobile-menu-open');
      sidebar.setAttribute('aria-hidden', 'false');
      sidebar.inert = false;
      mobileMenuToggle.setAttribute('aria-expanded', 'false');
      mobileMenuToggle.setAttribute('aria-label', 'Abrir menu');
      const menuIcon = $('#mobile-menu-icon');
      if (menuIcon) {
        menuIcon.textContent = '☰';
      }
      sidebarBackdrop.classList.remove('visible');
      sidebarBackdrop.hidden = true;
      window.clearTimeout(backdropHideTimer);
      return;
    }
    const isOpen = document.body.classList.contains('mobile-menu-open');
    sidebar.setAttribute('aria-hidden', String(!isOpen));
    sidebar.inert = !isOpen;
    mobileMenuToggle.setAttribute('aria-expanded', String(isOpen));
    mobileMenuToggle.setAttribute(
      'aria-label',
      isOpen ? 'Fechar menu' : 'Abrir menu'
    );
    const menuIcon = $('#mobile-menu-icon');
    if (menuIcon) {
      menuIcon.textContent = isOpen ? '×' : '☰';
    }
    if (!isOpen) {
      sidebarBackdrop.classList.remove('visible');
      sidebarBackdrop.hidden = true;
    }
  }
  function bindMobileSidebarEvents() {
    mobileMenuToggle?.addEventListener('click', () => {
      const isOpen = document.body.classList.contains(
        'mobile-menu-open'
      );
      setMobileMenuOpen(!isOpen, isOpen);
    });
    sidebarBackdrop?.addEventListener('click', () => {
      setMobileMenuOpen(false, true);
    });
    sidebar?.addEventListener('click', event => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('.nav-item, .brand')
      ) {
        setMobileMenuOpen(false, true);
      }
    });
    window.addEventListener('resize', syncMobileSidebarMode, {
      passive: true
    });
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartMenuOpen = false;
    let touchValid = false;
    document.addEventListener(
      'touchstart',
      event => {
        if (
          !isMobileSidebarLayout() ||
          document.querySelector('dialog[open]')
        ) {
          touchValid = false;
          return;
        }
        if (event.touches.length !== 1) {
          touchValid = false;
          return;
        }
        const touch = event.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartMenuOpen = document.body.classList.contains(
          'mobile-menu-open'
        );
        touchValid = true;
      },
      {
        passive: true,
        capture: true
      }
    );
    document.addEventListener(
      'touchend',
      event => {
        if (!touchValid || !isMobileSidebarLayout()) {
          touchValid = false;
          return;
        }
        touchValid = false;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const touchEndX = touch.clientX;
        const touchEndY = touch.clientY;
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;
        if (Math.abs(diffX) < 70) return;
        if (Math.abs(diffX) < Math.abs(diffY) * 1.2) return;
        if (touchStartMenuOpen) {
          if (diffX < -70) {
            setMobileMenuOpen(false, true);
          }
        } else {
          if (diffX > 70 && touchStartX <= 45) {
            setMobileMenuOpen(true);
          }
        }
      },
      {
        passive: true,
        capture: true
      }
    );

    // Cancela a detecção se o navegador interromper o toque.
    document.addEventListener(
      'touchcancel',
      () => {
        touchValid = false;
      },
      { passive: true }
    );
  }
  function bindEvents() {
    $('#add-book').addEventListener('click', openNewBook);
    $('#empty-add').addEventListener('click', openNewBook);
    $('#theme-toggle').addEventListener('click', () => setTheme(document.body.classList.contains('dark') ? 'light' : 'dark'));
    $('#connect-json').addEventListener('click', connectJSON);
    $('#export-json').addEventListener('click', exportJSON);
    $('#import-json').addEventListener('click', () => $('#import-file-input').click());
    $('#import-file-input').addEventListener('change', event => importJSONFile(event.target.files?.[0]));
    $('#help-json').addEventListener('click', () => helpModal.showModal());
    $('#book-form').addEventListener('submit', saveBookFromForm);
    $('#add-character').addEventListener('click', () => addCharacterRow());
    $('#characters-list').addEventListener('click', event => {
      const button = event.target.closest('.remove-character');
      if (!button) return;
      button.closest('.character-row').remove();
    });
    coverInput.addEventListener('change', event => processCover(event.target.files?.[0]));
    $('#remove-cover').addEventListener('click', () => { updateCoverPreview(''); toast('Capa removida.', 'warning'); });
    $('#search-input').addEventListener('input', render);
    $('#genre-filter').addEventListener('change', render);
    $('#status-filter').addEventListener('change', () => { activeNavStatus = ''; render(); });
    $('#sort-select').addEventListener('change', render);
    $('#clear-filters').addEventListener('click', clearFilters);
    $('#nav-all').addEventListener('click', () => { activeNavStatus = ''; $('#status-filter').value = ''; render(); });
    $$('[data-status-filter]').forEach(button => button.addEventListener('click', () => {
      activeNavStatus = button.dataset.statusFilter;
      $('#status-filter').value = '';
      render();
    }));
    $('#book-grid').addEventListener('click', event => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      const id = action.dataset.id;
      if (action.dataset.action === 'details') renderDetails(getBookById(id));
      if (action.dataset.action === 'edit') openEditBook(id);
      if (action.dataset.action === 'delete') deleteBook(id);
    });
    $('#book-grid').addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-action="details"]')) {
        event.preventDefault(); renderDetails(getBookById(event.target.dataset.id));
      }
    });
    $('#active-filters').addEventListener('click', event => {
      const button = event.target.closest('[data-clear-filter]');
      if (!button) return;
      if (button.dataset.clearFilter === 'search') $('#search-input').value = '';
      if (button.dataset.clearFilter === 'genre') $('#genre-filter').value = '';
      if (button.dataset.clearFilter === 'status') { $('#status-filter').value = ''; activeNavStatus = ''; }
      render();
    });
    $('#detail-content').addEventListener('click', event => {
      const button = event.target.closest('[data-detail-action]');
      if (!button) return;
      const { id, detailAction } = button.dataset;
      if (detailAction === 'edit') { detailModal.close(); openEditBook(id); }
      if (detailAction === 'delete') deleteBook(id);
    });
    $$('[data-close]').forEach(button => button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.close);
      if (dialog?.open) dialog.close();
    }));
    [editorModal, detailModal, helpModal].forEach(dialog => dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    }));
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); $('#search-input').focus();
      }
      if (event.key === 'Escape' && document.body.classList.contains('mobile-menu-open')) {
        setMobileMenuOpen(false, true);
      }
      if (event.key === 'Escape' && editorModal.open) $('#title-error').textContent = '';
    });
  }

  async function init() {
    books = loadLocalBooks();

    // A primeira abertura e a migração desta versão acrescentam os títulos padrão
    // sem apagar livros já cadastrados; o processo acontece apenas uma vez.
    mergeDefaultBooksOnce();

    try { setTheme(localStorage.getItem(THEME_KEY) || 'light'); } catch { setTheme('light'); }
    syncMobileSidebarMode();
    bindMobileSidebarEvents();
    bindEvents();
    await restoreLinkedHandle();
    render();
    const total = books.length;
    if (total) setSaveState('saved', linkedFileHandle ? 'Sincronizado com JSON' : 'Salvo neste navegador');
  }

  init();
})();
