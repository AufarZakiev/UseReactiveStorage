import { computed, MaybeRefOrGetter, ref, toValue, watch, WritableComputedRef } from "vue";
import { computedWithControl, useStorage } from '@vueuse/core'
import { RemovableRef } from "@vueuse/core/index.cjs";

type RemoveFirstFromTuple<T extends any[]> = 
  T['length'] extends 0 ? undefined :
  (((...b: T) => void) extends (a: any, ...b: infer I) => void ? I : []);

type OldTypes<T> = RemoveFirstFromTuple<RemoveFirstFromTuple<Parameters<typeof useStorage<T>>>>;

export function useReactiveStorage(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<string>, ...args: OldTypes<string>): WritableComputedRef<string, string>
export function useReactiveStorage(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<boolean>, ...args: OldTypes<boolean>): WritableComputedRef<boolean, boolean>
export function useReactiveStorage(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<number>, ...args: OldTypes<number>): WritableComputedRef<number, number>
export function useReactiveStorage<T>(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<T>, ...args: OldTypes<T>): WritableComputedRef<T, T>
export function useReactiveStorage<T = unknown>(key: MaybeRefOrGetter<string>, defaults: MaybeRefOrGetter<null>, ...args: OldTypes<T>): WritableComputedRef<T, T>

export function useReactiveStorage<T extends (string | number | boolean | object | null)>(
  key: MaybeRefOrGetter<string>,
  defaults: MaybeRefOrGetter<T>,
  ...args: OldTypes<T>
) {
  const getStorage = () => useStorage<T>(computedKey.value, defaults, ...[args[0], { ...args[1], listenToStorageChanges: false}])

  const computedKey = computed(() => toValue(key));
  let storageRef = getStorage();
  const valueRef = ref(storageRef.value);

  watch(valueRef, () => {
    storageRef.value = valueRef.value
  });

  watch(computedKey, () => {
    storageRef = getStorage();
    valueRef.value = storageRef.value;
  })

  return valueRef
}