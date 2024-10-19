import { customStorageEventName, defaultWindow, getSSRHandler, MaybeRefOrGetter, pausableWatch, RemovableRef, StorageEventLike, StorageLike, StorageSerializers, toValue, tryOnMounted, useEventListener, UseStorageOptions } from "@vueuse/core"
import { shallowRef, ref, nextTick, computed, watch } from "vue"

function guessSerializerType<T extends(string | number | boolean | object | null)>(rawInit: T) {
  return rawInit == null
    ? 'any'
    : rawInit instanceof Set
      ? 'set'
      : rawInit instanceof Map
        ? 'map'
        : rawInit instanceof Date
          ? 'date'
          : typeof rawInit === 'boolean'
            ? 'boolean'
            : typeof rawInit === 'string'
              ? 'string'
              : typeof rawInit === 'object'
                ? 'object'
                : !Number.isNaN(rawInit)
                    ? 'number'
                    : 'any'
}

export function useReactiveStorage(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<string>, storage?: StorageLike, options?: UseStorageOptions<string>): RemovableRef<string>
export function useReactiveStorage(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<boolean>, storage?: StorageLike, options?: UseStorageOptions<boolean>): RemovableRef<boolean>
export function useReactiveStorage(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<number>, storage?: StorageLike, options?: UseStorageOptions<number>): RemovableRef<number>
export function useReactiveStorage<T>(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<T>, storage?: StorageLike, options?: UseStorageOptions<T>): RemovableRef<T>
export function useReactiveStorage<T = unknown>(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<null>, storage?: StorageLike, options?: UseStorageOptions<T>): RemovableRef<T>

/**
 * Reactive LocalStorage/SessionStorage.
 *
 * @see https://vueuse.org/useStorage
 */
export function useReactiveStorage<T extends (string | number | boolean | object | null)>(
  key: MaybeRefOrGetter<string>,
  defaults: MaybeRefOrGetter<T>,
  storage: StorageLike | undefined,
  options: UseStorageOptions<T> = {},
): RemovableRef<T> {
  const {
    flush = 'pre',
    deep = true,
    listenToStorageChanges = true,
    writeDefaults = true,
    mergeDefaults = false,
    shallow,
    window = defaultWindow,
    eventFilter,
    onError = (e) => {
      console.error(e)
    },
    initOnMounted,
  } = options

  const data = (shallow ? shallowRef : ref)(typeof defaults === 'function' ? defaults() : defaults) as RemovableRef<T>
  const computedKey = computed(() => toValue(key));

  watch(computedKey, () => {
    update();
  })

  if (!storage) {
    try {
      storage = getSSRHandler('getDefaultStorage', () => defaultWindow?.localStorage)()
    }
    catch (e) {
      onError(e)
    }
  }

  if (!storage)
    return data

  const rawInit: T = toValue(defaults)
  const type = guessSerializerType<T>(rawInit)
  const serializer = options.serializer ?? StorageSerializers[type]

  const { pause: pauseWatch, resume: resumeWatch } = pausableWatch(
    data,
    () => write(data.value),
    { flush, deep, eventFilter },
  )

  if (window && listenToStorageChanges) {
    tryOnMounted(() => {
      /**
       * Attaching event listeners here should be fine since we are in a mounted hook
       *
       * The custom event is needed for same-document syncing when using custom
       * storage backends, but it doesn't work across different documents.
       *
       * TODO: Consider implementing a BroadcastChannel-based solution that fixes this.
       */
      if (storage instanceof Storage)
        useEventListener(window, 'storage', update)
      else
        useEventListener(window, customStorageEventName, updateFromCustomEvent)

      if (initOnMounted)
        update()
    })
  }

  // avoid reading immediately to avoid hydration mismatch when doing SSR
  if (!initOnMounted)
    update()

  function dispatchWriteEvent(oldValue: string | null, newValue: string | null) {
    // send custom event to communicate within same page
    if (window) {
      const payload = {
        key: computedKey.value,
        oldValue,
        newValue,
        storageArea: storage as Storage,
      }
      // We also use a CustomEvent since StorageEvent cannot
      // be constructed with a non-built-in storage area
      window.dispatchEvent(storage instanceof Storage
        ? new StorageEvent('storage', payload)
        : new CustomEvent<StorageEventLike>(customStorageEventName, {
          detail: payload,
        }))
    }
  }

  function write(v: unknown) {
    try {
      const oldValue = storage!.getItem(computedKey.value)

      if (v == null) {
        dispatchWriteEvent(oldValue, null)
        storage!.removeItem(computedKey.value)
      }
      else {
        const serialized = serializer.write(v as any)
        if (oldValue !== serialized) {
          storage!.setItem(computedKey.value, serialized)
          dispatchWriteEvent(oldValue, serialized)
        }
      }
    }
    catch (e) {
      onError(e)
    }
  }

  function read(event?: StorageEventLike) {
    const rawValue = event
      ? event.newValue
      : storage!.getItem(computedKey.value)

    if (rawValue == null) {
      if (writeDefaults && rawInit != null)
        storage!.setItem(computedKey.value, serializer.write(rawInit))
      return rawInit
    }
    else if (!event && mergeDefaults) {
      const value = serializer.read(rawValue)
      if (typeof mergeDefaults === 'function')
        return mergeDefaults(value, rawInit)
      else if (type === 'object' && !Array.isArray(value))
        return { ...rawInit as any, ...value }
      return value
    }
    else if (typeof rawValue !== 'string') {
      return rawValue
    }
    else {
      return serializer.read(rawValue)
    }
  }

  function update(event?: StorageEventLike) {
    if (event && event.storageArea !== storage)
      return

    if (event && event.key == null) {
      data.value = rawInit
      return
    }

    if (event && event.key !== key)
      return

    pauseWatch()
    try {
      if (event?.newValue !== serializer.write(data.value))
        data.value = read(event)
    }
    catch (e) {
      onError(e)
    }
    finally {
      // use nextTick to avoid infinite loop
      if (event)
        nextTick(resumeWatch)
      else
        resumeWatch()
    }
  }

  function updateFromCustomEvent(event: CustomEvent<StorageEventLike>) {
    update(event.detail)
  }

  return data
}