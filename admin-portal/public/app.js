const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];

const cfg = window.SIEN_SUPABASE_CONFIG || {};
const isConfigured = cfg.url && cfg.anonKey && !cfg.url.includes('YOUR_PROJECT_ID') && !cfg.anonKey.includes('YOUR_SUPABASE');
const sb = isConfigured && window.supabase ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;
const BUCKET = cfg.bucket || 'project-images';

const authView = $('#authView');
const appView = $('#appView');
const loginForm = $('#loginForm');
const logoutBtn = $('#logoutBtn');
const projectForm = $('#projectForm');
const projectList = $('#projectList');
const toastEl = $('#toast');
const publicWebsiteLink = $('#publicWebsiteLink');
if (publicWebsiteLink) publicWebsiteLink.href = cfg.publicWebsiteUrl || '#';

let currentProjects = [];
let mainFile = null;
let galleryFiles = [];
let currentMainUrl = '';
let currentGalleryUrls = [];

function toast(message, type='success'){
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast show ${type === 'error' ? 'error' : ''}`;
  setTimeout(() => toastEl.classList.remove('show'), 4200);
}

function slugify(value){
  return String(value || 'project').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function showAuth(){ authView.classList.remove('hidden'); appView.classList.add('hidden'); }
function showApp(){ authView.classList.add('hidden'); appView.classList.remove('hidden'); }

function fillUser(session){
  const email = session?.user?.email || 'admin@sien.co.ke';
  $('#userEmail').textContent = email;
  $('#userInitial').textContent = email[0]?.toUpperCase() || 'S';
}

function setLoading(button, state, label='Processing...'){
  if (!button) return;
  if (state) {
    button.dataset.original = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.original || button.textContent;
    button.disabled = false;
  }
}

async function checkSession(){
  if (!isConfigured || !sb) {
    showAuth();
    $('#setupHint').innerHTML = 'Supabase is not connected yet. Add your URL and anon key in <code>supabase-config.js</code>.';
    return;
  }
  const { data } = await sb.auth.getSession();
  if (data.session) {
    showApp();
    fillUser(data.session);
    await loadProjects();
  } else showAuth();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isConfigured || !sb) return toast('Connect Supabase first in supabase-config.js.', 'error');
  const button = loginForm.querySelector('button');
  setLoading(button, true, 'Signing in...');
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  setLoading(button, false);
  if (error) return toast(error.message, 'error');
  showApp(); fillUser(data.session); await loadProjects(); toast('Welcome to the SIEN project portal.');
});

logoutBtn.addEventListener('click', async () => {
  if (sb) await sb.auth.signOut();
  showAuth();
});

$('#refreshBtn').addEventListener('click', loadProjects);
$('#resetFormBtn').addEventListener('click', resetForm);

$('#mainImage').addEventListener('change', e => {
  mainFile = e.target.files[0] || null;
  previewFiles([mainFile].filter(Boolean), $('#mainPreview'));
});
$('#galleryImages').addEventListener('change', e => {
  galleryFiles = [...e.target.files];
  previewFiles(galleryFiles, $('#galleryPreview'));
});

function previewFiles(files, mount){
  if (!mount) return;
  mount.innerHTML = '';
  files.forEach(file => {
    const img = document.createElement('img');
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    mount.appendChild(img);
  });
}

async function resizeImage(file, maxWidth=1900, quality=.84){
  if (!file || !file.type.startsWith('image/')) return file;
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
  const ratio = Math.min(1, maxWidth / img.width);
  const width = Math.round(img.width * ratio);
  const height = Math.round(img.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
}

async function uploadImage(file, folder){
  if (!file) return null;
  const optimized = await resizeImage(file);
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe.replace(/\.[^.]+$/, '.jpg')}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, optimized, { cacheControl: '31536000', upsert: false, contentType: 'image/jpeg' });
  if (error) throw error;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

projectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) return toast('Connect Supabase first.', 'error');
  const button = $('#saveProjectBtn');
  setLoading(button, true, 'Saving...');
  try {
    const title = $('#title').value.trim();
    const editingId = $('#projectId').value;
    const baseSlug = slugify(title);
    const folder = editingId || baseSlug;
    const mainImageUrl = mainFile ? await uploadImage(mainFile, folder) : currentMainUrl;
    const uploadedGallery = [];
    for (const file of galleryFiles) uploadedGallery.push(await uploadImage(file, folder));
    const gallery = [...currentGalleryUrls, ...uploadedGallery].filter(Boolean);
    const highlights = $('#highlights').value.split('\n').map(x => x.trim()).filter(Boolean);
    const payload = {
      title,
      slug: editingId ? undefined : baseSlug,
      category: $('#category').value,
      status: $('#status').value,
      location: $('#location').value.trim(),
      year: $('#year').value.trim(),
      size: $('#size').value.trim(),
      description: $('#description').value.trim(),
      scope: $('#scope').value.trim(),
      highlights,
      main_image_url: mainImageUrl || gallery[0] || '',
      gallery_images: gallery.length ? gallery : (mainImageUrl ? [mainImageUrl] : []),
      is_featured: $('#isFeatured').checked,
      is_published: $('#isPublished').checked,
      updated_at: new Date().toISOString()
    };
    if (!editingId) payload.created_at = new Date().toISOString();
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
    const query = editingId ? sb.from('projects').update(payload).eq('id', editingId) : sb.from('projects').insert(payload);
    const { error } = await query;
    if (error) throw error;
    resetForm();
    await loadProjects();
    toast(editingId ? 'Project updated successfully.' : 'Project saved and synced.');
  } catch (err) {
    toast(err.message || 'Could not save project.', 'error');
  } finally {
    setLoading(button, false);
  }
});

async function loadProjects(){
  if (!sb) return;
  const { data, error } = await sb.from('projects').select('*').order('created_at', { ascending: false });
  if (error) return toast(error.message, 'error');
  currentProjects = data || [];
  renderStats();
  renderProjectList();
}

function renderStats(){
  const total = currentProjects.length;
  const published = currentProjects.filter(p => p.is_published).length;
  const drafts = total - published;
  const categories = new Set(currentProjects.map(p => p.category).filter(Boolean)).size;
  $('#statTotal').textContent = total;
  $('#statPublished').textContent = published;
  $('#statDrafts').textContent = drafts;
  $('#statCategories').textContent = categories;
}

function renderProjectList(){
  if (!projectList) return;
  if (!currentProjects.length) {
    projectList.innerHTML = '<div class="empty">No projects uploaded yet. Add your first project above and publish it to the public website.</div>';
    return;
  }
  projectList.innerHTML = currentProjects.map(p => `
    <article class="project-row" data-id="${p.id}">
      <img src="${escapeHtml(p.main_image_url || (p.gallery_images || [])[0] || 'assets/sien-logo.png')}" alt="${escapeHtml(p.title)}" />
      <div>
        <h3>${escapeHtml(p.title)}</h3>
        <p>${escapeHtml(p.description || '')}</p>
        <div class="chips"><span>${escapeHtml(p.category || '')}</span><span>${escapeHtml(p.status || '')}</span><span>${escapeHtml(p.location || '')}</span><span class="${p.is_published ? 'live' : 'draft'}">${p.is_published ? 'Published' : 'Draft'}</span></div>
      </div>
      <div class="row-actions">
        <button type="button" data-action="edit">Edit</button>
        <button type="button" data-action="toggle">${p.is_published ? 'Unpublish' : 'Publish'}</button>
        <button type="button" class="delete" data-action="delete">Delete</button>
      </div>
    </article>`).join('');
  $$('.project-row button').forEach(btn => btn.addEventListener('click', handleRowAction));
}

async function handleRowAction(e){
  const row = e.target.closest('.project-row');
  const id = row.dataset.id;
  const project = currentProjects.find(p => p.id === id);
  const action = e.target.dataset.action;
  if (!project) return;
  if (action === 'edit') return editProject(project);
  if (action === 'toggle') {
    const { error } = await sb.from('projects').update({ is_published: !project.is_published, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return toast(error.message, 'error');
    await loadProjects();
    toast(project.is_published ? 'Project moved to draft.' : 'Project published to public website.');
  }
  if (action === 'delete') {
    if (!confirm(`Delete ${project.title}? This removes it from the live portfolio list.`)) return;
    const { error } = await sb.from('projects').delete().eq('id', id);
    if (error) return toast(error.message, 'error');
    await loadProjects();
    toast('Project deleted.');
  }
}

function editProject(p){
  $('#formTitle').textContent = 'Edit Project';
  $('#projectId').value = p.id;
  $('#title').value = p.title || '';
  $('#category').value = p.category || 'Residential';
  $('#status').value = p.status || 'Design Phase';
  $('#location').value = p.location || '';
  $('#year').value = p.year || '';
  $('#size').value = p.size || '';
  $('#description').value = p.description || '';
  $('#scope').value = p.scope || '';
  $('#highlights').value = Array.isArray(p.highlights) ? p.highlights.join('\n') : '';
  $('#isFeatured').checked = !!p.is_featured;
  $('#isPublished').checked = !!p.is_published;
  currentMainUrl = p.main_image_url || '';
  currentGalleryUrls = Array.isArray(p.gallery_images) ? p.gallery_images : [];
  mainFile = null; galleryFiles = [];
  $('#mainImage').value = ''; $('#galleryImages').value = '';
  $('#mainPreview').innerHTML = currentMainUrl ? `<img src="${escapeHtml(currentMainUrl)}" alt="Current main image" />` : '';
  $('#galleryPreview').innerHTML = currentGalleryUrls.map(url => `<img src="${escapeHtml(url)}" alt="Gallery image" />`).join('');
  document.querySelector('#add-project').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm(){
  $('#formTitle').textContent = 'Add New Project';
  projectForm.reset();
  $('#projectId').value = '';
  $('#isPublished').checked = true;
  $('#mainImage').value = '';
  $('#galleryImages').value = '';
  $('#mainPreview').innerHTML = '';
  $('#galleryPreview').innerHTML = '';
  mainFile = null; galleryFiles = []; currentMainUrl = ''; currentGalleryUrls = [];
}

checkSession();
