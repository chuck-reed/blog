+++

title = "Removing Tauri's Params Trait"
description = "Why we decided to remove Tauri's Params trait during beta even though it caused a breaking change."
date = 2021-07-16

[taxonomies]
tags=["Rust", "Tauri"]

+++

In the latest beta release (1.0.0-beta.5) of [Tauri], we made a breaking change that removed the
`Params` trait. `Params` was a new addition in the first beta release candidate to utilize user defined types for Tauri
APIs along with an additional hope to support future non-breaking features with user defined types. The goal of user
defined types was being able to have strong types, such as an enum, represent things like events or window labels
instead of a string to catch mistakes during compilation. It helped prevent accidentally passing in a typo or
non-existent window, but does not help logic errors such as passing in `MyWindow::Primary` when you meant
`MyWindow::Secondary`.

## Removing `Params` Existing Applications

If you are reading this article because you want to know how to remove your usages of `Params` from your code then you
might be interested in one or both of the next sections. There were two ways of using `Params` before it's removal, the
most common use case was needing to specify it as a trait bounds for your own functions/methods. The other way was
utilizing the user defined types of `Params` by supplying custom types to the builder. I will go over solutions to these
in order.

### Trait Bounds

If you are using `Params` as a [trait bound], then you likely have code that looks vaguely like the following:

```rust
fn send_init_event<P: Params<Event=String>>(window: &Window<P>) {
    window.emit("init", ());
}
```

All items that used `Params` as a generic now use `Runtime`. Additionally, they also implement a default `Runtime` if
you are using [wry] (you probably are). This means that the simplest transformation for people using the default setup
provided by [Tauri] is:

```rust
fn send_init_event(window: &Window) {
    window.emit("init", ());
}
```

<details>
<summary>I am using a custom runtime</summary>

In the case that you **do** happen to be using a custom `Runtime` (which we would love to hear about), then either of
the following should work fine.

```rust
fn send_init_event_direct(window: &Window<MyCustomRuntime>) {
    window.emit("init", ());
}

fn send_init_event_bounds<R: Runtime>(window: &Window<R>) {
    window.emit("init", ());
}
```

</details>

### Custom Types

The second way to use `Params` was to pass custom types to `Builder::new()` to utilize custom types for events, window
labels, and more. It is not necessary to remove these custom types completely, but they may need to be converted to a
string or string slice when passing them into API functions now. Additionally, you will need to drop them as arguments
for the builder.

The way to write the builder if you are using [wry] is:

```rust
tauri::Builder::default ()
```

Or, if you are using a custom runtime (which we would love to hear about):

```rust
tauri::Builder::new::<MyCustomRuntime>()
```

All the previous custom types had a hard requirement to be "string-able" which was enforced through `Display` and
`Serialize`. The APIs that previously took owned values or references of the custom types now accept `Into<String>` and
`&str` respectively. The breaking change may affect you if your types as they exist right now do not coerce into those
types, so you may need to add some conversions during calls to the API.

## The History of `Params`

_If you just wanted to know how to update your [Tauri] application to 1.0.0-beta.5, then everything after this point is
not necessary._

### The Original Goals

These were the motivating factors for adding `Params` to [`tauri`], not the motivating factors behind [Tauri] itself. I
will be referring to these later as the original goals.

1. Ability to enforce the correct user defined type at compile time.
2. Enable the use of lightweight types such as those implementing `Copy`.
3. Better developer experience by allowing enums for types that have limited values.
4. Allow expansion of custom types for future features without breaking changes.

### What is `Params`?

For some context to `Params`, here is the trait definition:

```rust
/// Types associated with the running Tauri application.
pub trait Params: private::ParamsBase + 'static {
    /// The event type used to create and listen to events.
    type Event: Tag;

    /// The type used to determine the name of windows.
    type Label: Tag;

    /// The type used to determine window menu ids.
    type MenuId: MenuId;

    /// The type used to determine system tray menu ids.
    type SystemTrayMenuId: MenuId;

    /// Assets that Tauri should serve from itself.
    type Assets: Assets;

    /// The underlying webview runtime used by the Tauri application.
    type Runtime: Runtime;
}
```

[`Tag`] and [`MenuId`] represent string-able types, which is important to keep in mind in the future. The trait
was [sealed] to allow us to expand (not change) the trait in the future without breaking changes. You had to use the
builder to actually set the types, which became tedious over time. For example, the `Default` implementation:

```rust
/// Make `Wry` the default `Runtime` for `Builder`
#[cfg(feature = "wry")]
impl<A: Assets> Default for Builder<String, String, String, String, A, crate::Wry> {
    fn default() -> Self {
        Self::new()
    }
}
```

`Builder` was complex generic-wise due to the "you must declare everything at once" format. This complexity focused on
the builder and left other items to only need to worry about having `Params`. Except, it kind of didn't. Users still
needed to add a `Params` bound to their own functions and methods they were creating with the associated type that they
were trying to use. Even more frustrating, it required it even for `String` even though it was the default.

```rust
// this application uses Builder::default()
fn say_hi_to_bob<P: Params<Event=String>>(window: &Window<P>) {
    window.emit("bob", "hi");
}
```

We just wanted to use the default types, why do I need to specify all this other stuff? If we omitted the
`<Event = String>` portion and just used `<P: Params>` then the compilation would fail with something similar to:

```
error[E0308]: mismatched types
  note: expected type `<P as Params>::Event`
        found reference `&str`
```

This is because `Window::emit` knows that it should take `P::Event` but in that function definition, it doesn't know
what type that resolves to. For every method used that uses an associated type, the concrete type needs to be specified
in order to compile. If the `say_hi_to_bob` function also contained methods that used the window label and menu id, you
can see how it gets tedious quickly:

```rust
// this application uses Builder::default()
fn say_hi_to_bob<P: Params<Event=String, Label=String, MenuId=String>>(window: &Window<P>) {
    window.emit("bob", "hi");
    window.emit_to("main", "bob", "hi");
    window.on_menu_event(|_menu_event| {
        // something
    });
}
```

This was mitigated somewhat in 1.0.0-beta.0 when we added a default type to all the items taking `Params`. It allowed
omitting the generic completely if you used the default types. Custom types still needed to be listed explicitly,
leaving some signatures very complex. There is still a trick to reduce verbosity in this case though:

```rust
// Event, Window, Menu, and SystemMenu are existing custom types
trait Params: tauri::Params<Event=Event, Label=Window, MenuId=Menu, SystemTrayMenuId=SystemMenu> {}

impl<P> Params for P where P: tauri::Params<Event=Event, Label=Window, MenuId=Menu, SystemTrayMenuId=SystemMenu> {}
```

You could then use that trait around your application code and only need to worry about specifying the types in the
trait definition instead of all around your application. So why was `Params` still problematic? Sure it was verbose in
the builder and your trait helper, but was that really enough to remove it? From a code perspective, this was solved. We
had solutions for most of the verbosity problems encountered during development, but an equal or greater problem was the
mental complexity it introduced. For users unfamiliar with Rust, and sometimes newer to programming in general, this was
a massive pain point. They could use a `&String` or a `&str` with `window.emit(...)` in their code but figuring that out
from the signatures was not easy. For example, here is the same method with and without `Params`:

```rust
// without Params
fn emit_to<S>(&self, label: &str, event: &str, payload: S) -> Result<()>
    where S: Serialize + Clone
{
    self
        .manager()
        .emit_filter(event, payload, |w| label == w.label())
}

// with Params
fn emit_to<E: ?Sized, L: ?Sized, S: Serialize + Clone>(
    &self,
    label: &L,
    event: &E,
    payload: S,
) -> Result<()>
    where
        P::Label: Borrow<L>,
        P::Event: Borrow<E>,
        L: TagRef<P::Label>,
        E: TagRef<P::Event>,
{
    self
        .manager()
        .emit_filter(event, payload, |w| label == w.label())
}
```

The signature when using `Params` may be somewhat familiar to those who know [`HashMap`] as it works off a similar
concept. `E` and `L` accept a type that is a reference to the specific owned custom type. Like `HashMap::get`, the
function would accept `&str` if the [`Tag`] (Event, Label) was `String` - along with allowing similar mechanics for
custom types. This is not clear to people unfamiliar or new to Rust and causes some unnecessarily complex signatures in
the documentation that many users find difficult to grok. Having multiple of these bounds per signature only added to
the confusion.

So what about having these custom types only on items they affect and dropping `Params` if it wasn't working out well?
Unsurprisingly, this was the first approach but quickly grew unmanageable as most items all the generics due to the
flexibility of the API. This flexibility comes in many forms, the core of which involves allowing a custom webview
runtime to be set (we provide [wry] by default).

The [Tauri Runtime] is a layer between [Tauri] and the underlying webview runtime. It provides the core traits that
enable us to pass messages to the webview runtime without worrying about the underlying webview runtime or platform.
Because of this, it is up to the underlying webview runtime to implement those traits for whatever platforms they want
to support. Thus, the `Runtime` trait purpose can be simplified to a "cross-platform message dispatcher to the native
platform." This is why the `Runtime` trait appears on most items that can interact with the webview, such as [`Window`],
[`App`], or [`Invoke`].

Similar to needing `Runtime` when sending messages to the native webview runtime, types that need to use a user defined
type require the generic somewhere. Additionally, if it holds another type that uses other user defined types then it
needs those generics too! Effectively, all of them were needed everywhere most of the time due to types "infecting"
other types. This is the problem that `Params` solved for the [original goals].

## Correcting the Course for the Future

We still want the items described in the [original goals], so how do we achieve it without `Params` or making a mess of
generics in the [`tauri`] crate? This is an article about the removal of `Params`, so we definitely have found our way
forward, but what drove the decision?

### Downsides of the Original Goals

What did our implementation of the [original goals] with `Params` make us compromise in order to achieve them?

#### Complicated API

The API resulting from `Params` (and similar solutions we discussed before) was much too complex for most Rust beginners
and some intermediate users. An important goal for [Tauri] is to be welcoming to newcomers in the community and
ecosystem. Due to our stack enabling native applications with web technology, we naturally see a lot of developers who
aren't familiar with Rust but know JavaScript/TypeScript. Many are already familiar with other platforms that enable
cross-platform desktop applications build with web technology, such as [Electron], and are interested in some benefits
that [Tauri] offers.

#### Maintenance

This is the downside that actually sparked the Pull Request that removed `Params`. While not more or less important than
other downsides, it was the cause for us to re-evaluate the implementation of the [original goals]. The internal code
had turned complex in a number of places alongside triggering lints like `clippy::type_complexity`. Places where we
accepted references to custom types had many bounds to consider and any type that used `Params` had to deal with the
associated types. Code that parsed strings into the custom types were also surrounded by boilerplate error handling to
panic if the custom type `FromStr` implementation didn't handle unknown string internally.

### Re-evaluating

We had some internal discussion of ways to shed all this complexity from implementing the [original goals] without
losing the benefit of those goals. In the end, a core idea took hold - **these strong user defined types do _not_ need
to be part of the [`tauri`] crate**. In fact, all the goals can be more-or-less effectively implemented by another
higher level crate which wraps the core.

This is because of the underlying [Tauri Runtime] requirements which use strings to pass messages around. If we store
custom types in core, then at some point we have to turn it into a string to pass it down to the underlying runtime. If
we forgo inserting custom types into core and settle on strings, we can simplify the exposed core API while still
allowing at a higher level to use better types. A few immediate benefits of only using strings is a much simpler API and
less complex code to deal with in core. Do we lose any benefits? Not really.

Let's talk about the first goal, enforcing the correct type at compile time. A higher level crate can just as
effectively enforce this by wrapping the current core API. This is effectively moving the `Params` trait out of core and
into a separate crate and handling all strong typing there. A (maybe) surprising benefit of this is that even if
`Params` itself stays complex in this new higher level crate, it is self-contained and does not need to be handled by
the core itself. Additionally, there are other patterns that would allow us to expose it unsealed (AKA users can
implement the trait) to prevent the headache of providing a private concrete type for the sealed trait. Part of this is
possible by allowing the higher level crate to be less stable than [`tauri`] itself, allowing for more API evolution.
The stability of the core crate is extremely important because we want to keep the guts of [`tauri`] without excessive
major changes after we perform the third-party security audit of the core codebase.

The second goal is about enabling the use of lightweight types. This means type that can be passed relatively
efficiently with `Copy`, such as enums that only contain `Copy` types. This turned out to not matter so much in the core
because as previously stated, at some point during storage the type has to be converted to a string of some form. A
higher level crate still allows for `Copy` types in the application code while still handling them as strings in core.

The third goal is about allowing a better developer experience by using Rust's typing system to handle more things. In
the most common case, this is about being able to use Rust's great enums to limit the allowed values of events, window
labels, and menu items. A higher level crate could still provide this benefit.

Do you see the theme here?

The final goal is about expanding strong types for future non-breaking [Tauri] features. Technically that point was
about also providing the strong typing in a non-breaking manner, but let's forget about that for a minute. While
discussing the first goal, we mentioned that the stability of the higher level crate being acceptably less stable
than [`tauri`] core. Additionally, there were no concrete plans of how to expand the builder and `Params` in a
non-breaking way for new features as we had not reached that point. So we are accepting the less strict stability
requirements for satisfying goal number four. There are also options in the higher level crate to provide non-breaking
strongly typed APIs in various manners.

To recap, a higher level crate can provide an acceptably less-stable API to perform the same compile-time type
checking. [`tauri`] core can stay the same, which is beneficial for the audit that will be performed on it.

I've been calling it the concept of stronger type checking in another crate as a higher level crate. This "higher level
crate" does not currently exist as an available library, but may soon in the future based on lessons we've learned with
current strong typing mechanics. Nevertheless, these concepts do not need to be exposed as a higher level crate in order
to take advantage of the stronger typing.

## Stronger Typing, Now

I will go over various methods that you can take advantage of directly in your own application code without needing a
higher level crate to provide it. _A uniform higher level crate would make it easier, however._ The methods require a
variety of Rust knowledge, but from this point on I will assume you have read and understood [The Rust Book] along with
a fair amount of practice.

### 

### Wrapping Tauri Core

Do I really want to go into this for an example? The code is rather in depth and complex compared to others.

[Tauri]: https://github.com/tauri-apps/tauri

[wry]: https://github.com/tauri-apps/wry

[trait bound]: https://doc.rust-lang.org/rust-by-example/generics/bounds.html\

[Tauri Runtime]: https://docs.rs/tauri-runtime

[`Window`]: https://docs.rs/tauri/1.0.0-beta.5/tauri/window/struct.Window.html

[`App`]: https://docs.rs/tauri/1.0.0-beta.5/tauri/struct.App.html

[`Invoke`]: https://docs.rs/tauri/1.0.0-beta.5/tauri/struct.Invoke.html

[sealed]: https://rust-lang.github.io/api-guidelines/future-proofing.html#sealed-traits-protect-against-downstream-implementations-c-sealed\

[`HashMap`]: https://doc.rust-lang.org/std/collections/struct.HashMap.html

[`Tag`]: https://github.com/tauri-apps/tauri/blob/7ee2dc8b690703f509ab2d6ecdf9dafd6b72cd0b/core/tauri-runtime/src/tag.rs

[`MenuId`]: https://github.com/tauri-apps/tauri/blob/7ee2dc8b690703f509ab2d6ecdf9dafd6b72cd0b/core/tauri-runtime/src/lib.rs#L35-L38

[original goals]: #the-original-goals

[`tauri`]: https://docs.rs/tauri/1.0.0-beta.5/tauri/

[Electron]: https://www.electronjs.org/

[The Rust Book]: https://doc.rust-lang.org/book/