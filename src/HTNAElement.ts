import { DOMAccess } from "./DOMAccess";
import { AttributesAccess, AttributesMap, AttributesSchema, AttributesTypes } from "./AttributesAccess";
import { SlotAccess } from "./SlotAccess";
import { camelCase } from "./utils";
import { Registry } from "./Registry";
import { StyleAccess } from "./StyleAccess";


/** Data type for the accepted result from the render() function as ShadowDOM content */
export type Template = string | HTMLElement | DocumentFragment;

/** Interface of arguments for render() and controller() functions */
export interface ControllerArguments {
  /** DOM Element Node for the current instance */
  element: DefinedHTMLElement;
  /** Instance of *DOMAccess* for access the LightDOM of current Element */
  light: DOMAccess<HTMLElement>;
  /** Instance of *DOMAccess* for access the ShadowDOM of current Element */
  shadow: DOMAccess<ShadowRoot>;
  /** Instance of *HTNAAttributesAccess* for access the attributes of current element with Schema */
  attributes: AttributesAccess;
  /** Instance of *StyleAccess* for access to the styling utilities  */
  style: StyleAccess<HTMLElement | ShadowRoot>;
  /** Instance of *SlotAccess* for access to the slots utilities  */
  slot: SlotAccess;
}

/**
 * Base callback for ControllerResult
 */
export type BaseCallback = () => void;

/**
 * Attribute change callback for ControllerResult
 * @param name The name of the changed attribute
 */
export type AttributeChangedCallback = (name: string, oldValue: string, newValue: string) => void

/** Attribute change Name-Callback dictionary for ControllerResult */
export type AttributeChangesCallbackRecord = Record<string, AttributeChangedCallback>;

/** Properties Name-Descriptor dictionary for ControllerResult */
export type PropertiesDescriptorsRecord = Record<string, PropertyDescriptor>;

/** Interface of expected result from controller() function invocation */
export interface ControllerResult {
  /** Executed at native custom element connectedCallback() */
  connectedCallback?: BaseCallback;
  /** Executed at native custom element disconnectedCallback() */
  disconnectedCallback?: BaseCallback;
  /** Executed at native custom element adoptedCallback() */
  adoptedCallback?: BaseCallback;
  /** Executed at native custom element attributeChangedCallback() */
  attributeChangedCallback?: AttributeChangedCallback | AttributeChangesCallbackRecord;
  /** Executed when a MutationObserver event occurs in the light DOM of the element */
  mutationObserverCallback?: MutationCallback;
  /** The initialization configuration of the light DOM MutationObserver */
  mutationObserverInit?: MutationObserverInit;
  /** Record of event listeners to add to the Element */
  listeners?: Record<string, EventListenerOrEventListenerObject>;
  /** Record of descriptors to define getters and setters of DOM node properties */
  properties?: PropertiesDescriptorsRecord;
}

/** Type of rendering function used to generate the custom element HTML content */
export type RenderFunction = (controllerArguments: ControllerArguments) => Template;

/** Type of controller function to apply Element logic */
export type ControllerFunction = (controllerArguments: ControllerArguments) => ControllerResult | void;

export interface HTNAElementConfig {
  /** The tag name of the custom element */
  elementName?: string;
  /** Rendering function used to generate the custom element HTML content */
  render?: RenderFunction;
  /** Style CSS string for Element ShadowDOM */
  style?: string;
  /** Controller function to apply Element logic */
  controller?: ControllerFunction;
  /** Map with initial attributes values */
  attributes?: AttributesMap;
  /** Schema definition for types, observed and property attributes */
  attributesSchema?: AttributesSchema;
  /** Shadow DOM mode, false to disable */
  shadow?: "open" | "closed" | false;
  /** Tag name to extend **/
  extends?: string;
}


/**
 * Extended HTMLElement for user defined elements with define() function
 * @noInheritDoc
 */
export interface DefinedHTMLElement extends HTNAElement {
  new(): HTNAElement;
  prototype: HTNAElement;
  /** Other properties of the node for accessing the values of the attributes in accordance with the *AttributesSchema* */
  [key: string]: any;
}

export class HTNAElement extends HTMLElement {
  static config: HTNAElementConfig;

  private static observedAttributesArray: string[];

  static get observedAttributes (): string[] {
    if(!this.observedAttributesArray) {
      this.observedAttributesArray = [];
      if(this.config.attributesSchema) {
        for(const name in this.config.attributesSchema) {
          if(this.config.attributesSchema[name].observed) {
            this.observedAttributesArray.push(name);
          }
        }
      }
    }
    return this.observedAttributesArray;
  }

  private shadow: ShadowRoot;
  protected controllerResult: ControllerResult = {};
  protected access: ControllerArguments;
  private defaultAttributes: Map<string, any> = new Map();
  protected initiated: boolean = false;
  private mutationObserver: MutationObserver;

  constructor () {
    super();

    const constructor = this.constructor as typeof HTNAElement;
    const config      = constructor.config;

    const attributesSchema: AttributesTypes   = {};
    const propertyAttributes: string[] = [];
    const toDispatchAttributes: Record<string, string | boolean> = {};

    if(config.attributesSchema) {
      for(const name in config.attributesSchema) {
        const attribute = config.attributesSchema[name];
        if(attribute.type) {
          attributesSchema[name] = attribute.type;
        }
        if(attribute.property) {
          propertyAttributes.push(name);
        }
        if(attribute.value !== undefined) {
          this.defaultAttributes.set(name, attribute.value);
        }
        toDispatchAttributes[name] = attribute.dispatchEvent || false;
      }
    }

    if(config.shadow !== false) {
      this.shadow = this.attachShadow({
        mode: config.shadow || "closed"
      });
    }

    this.access = Object.freeze({
      element: this as unknown as DefinedHTMLElement,
      shadow: this.shadow ? new DOMAccess(this.shadow) : null,
      light: new DOMAccess(this),
      attributes: new AttributesAccess(this, attributesSchema, toDispatchAttributes),
      style: this.shadow ? new StyleAccess(this.shadow) : new StyleAccess(this),
      slot: new SlotAccess(this)
    });

    const attributesAccess = this.access.attributes;

    // Add getter / setter for properties
    for(const attributeName of propertyAttributes) {
      const propertyName = camelCase(attributeName);
      Object.defineProperty(this, propertyName, {
        get: () => attributesAccess.get(attributeName),
        set: (value: any) => attributesAccess.set(attributeName, value)
      });
    }
  }

  private defineProperties (properties: PropertiesDescriptorsRecord): void {
    for(const name in properties) {
      Object.defineProperty(this, name, properties[name]);
    }
  }

  private appendRender (renderFn: RenderFunction): void {
    const renderResult = renderFn(this.access);
    if(this.access.shadow) {
      this.access.shadow.append(renderResult);
    } else {
      this.access.light.append(renderResult);
    }
  }

  private appendStyle (style: string): void {
    this.access.style.addStyle(style);
  }

  connectedCallback (): void {
    if(!this.initiated) {
      this.initiated = true;

      const constructor = this.constructor as typeof HTNAElement;
      const config      = constructor.config;

      // Set the initial attributes values
      const attributesAccess = this.access.attributes;
      this.defaultAttributes.forEach((value: any, name: string) => {
        if(!attributesAccess.has(name)) {
          attributesAccess.set(name, value);
        }
      });

      this.afterAttributesInit();

      if(config.render) {
        this.appendRender(config.render);
      }

      if(config.style) {
        this.appendStyle(config.style);
      }

      if(config.controller) {
        this.controllerResult = config.controller(this.access) || {};

        if(this.controllerResult.properties) {
          this.defineProperties(this.controllerResult.properties);
        }
      }

      window.customElements.upgrade(this);
    }

    if(this.controllerResult.listeners) {
      for(const name in this.controllerResult.listeners) {
        this.addEventListener(name, this.controllerResult.listeners[name]);
      }
    }

    if(this.controllerResult.mutationObserverCallback) {
      // TODO: simplify Mutations search
      this.mutationObserver = new MutationObserver(this.controllerResult.mutationObserverCallback);
      const init: MutationObserverInit = this.controllerResult.mutationObserverInit || {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true
      };
      this.mutationObserver.observe(this, init);
    }

    this.afterMutationObserverInit();

    if(this.controllerResult.connectedCallback) {
      this.controllerResult.connectedCallback();
    }
  }

  protected afterAttributesInit (): void {
    //
  }

  protected afterMutationObserverInit (): void {
    //
  }

  disconnectedCallback (): void {
    if(this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if(this.controllerResult.listeners) {
      for(const name in this.controllerResult.listeners) {
        this.removeEventListener(name, this.controllerResult.listeners[name]);
      }
    }
    if(this.controllerResult.disconnectedCallback) {
      this.controllerResult.disconnectedCallback();
    }
  }

  adoptedCallback (): void {
    if(this.controllerResult.adoptedCallback) {
      this.controllerResult.adoptedCallback();
    }
  }

  attributeChangedCallback (name: string, oldValue: any, newValue: any): void {
    if(this.controllerResult.attributeChangedCallback) {
      if(typeof this.controllerResult.attributeChangedCallback === "function") {
        this.controllerResult.attributeChangedCallback(name, oldValue, newValue);
      } else if(this.controllerResult.attributeChangedCallback[name]) {
        this.controllerResult.attributeChangedCallback[name](name, oldValue, newValue);
      }
    }

    const dispatchName = this.access.attributes.getDispatchName(name);
    if(dispatchName) {
      this.access.light.dispatch(dispatchName, {
        name,
        value: newValue,
        oldValue: oldValue
      });
    }
  }

  public static register (elementName: string = this.config.elementName): void {
    const actual = Registry.get(elementName) as typeof HTMLElement;
    if(!actual) {
      Registry.add(elementName, this);
    } else if(actual !== this) {
      throw new Error(`"${elementName}" element already registered with another class`);
    }
  }
}
