<?php
/**
 * Plugin Name: Riverz — Recuperación de carritos
 * Description: Avisa a Riverz cuando alguien deja el checkout a medias, para poder escribirle por WhatsApp con un link que restaura su carrito.
 * Version:     1.0.0
 * Author:      Riverz
 * Author URI:  https://riverz.co
 * License:     GPLv2 or later
 * Text Domain: riverz-cart-recovery
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * WC requires at least: 7.0
 *
 * WooCommerce no tiene carritos abandonados en el núcleo. Riverz ya
 * rescata a quien apretó "realizar pedido" y no pagó (queda un pedido
 * `pending`, que llega por el webhook normal de pedidos), pero a quien
 * abandona ANTES de enviar el pedido solo se lo puede ver desde adentro
 * de la tienda. Para eso existe este plugin.
 *
 * Qué hace, en concreto:
 *   1. En el checkout, apenas el comprador deja su correo o su teléfono,
 *      manda a Riverz una foto del carrito con esos datos.
 *   2. Genera un link de recuperación que RESTAURA el carrito y lleva al
 *      checkout. Sin eso, el mensaje de recuperación mandaría a la
 *      persona a una tienda vacía y habría que rearmar la compra a mano.
 *   3. Cuando el pedido se concreta, avisa para que Riverz cierre el
 *      carrito y nadie reciba un "dejaste algo pendiente" después de
 *      haber comprado.
 *
 * El carrito NUNCA se arma con lo que manda el navegador: se lee del lado
 * del servidor desde la sesión de WooCommerce. Si no, cualquiera podría
 * inyectar productos y precios falsos en la tienda.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RIVERZ_CR_VERSION', '1.0.0' );
define( 'RIVERZ_CR_OPTION', 'riverz_cr_settings' );
define( 'RIVERZ_CR_TOKEN_KEY', 'riverz_cr_token' );

/** Cuánto sobrevive un carrito guardado para poder restaurarlo. */
define( 'RIVERZ_CR_TTL', 30 * DAY_IN_SECONDS );

/**
 * WooCommerce es un requisito duro: sin él no hay carrito que recuperar.
 * Avisamos en el panel en vez de romper el sitio con un fatal.
 */
function riverz_cr_woocommerce_missing() {
	echo '<div class="notice notice-error"><p>';
	esc_html_e( 'Riverz — Recuperación de carritos necesita WooCommerce activo.', 'riverz-cart-recovery' );
	echo '</p></div>';
}

function riverz_cr_boot() {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', 'riverz_cr_woocommerce_missing' );
		return;
	}

	add_action( 'rest_api_init', 'riverz_cr_register_routes' );
	add_action( 'wp_enqueue_scripts', 'riverz_cr_enqueue' );
	add_action( 'init', 'riverz_cr_maybe_restore_cart' );
	add_action( 'woocommerce_checkout_order_processed', 'riverz_cr_on_order_created', 10, 1 );
	add_action( 'admin_menu', 'riverz_cr_admin_menu' );
	add_action( 'admin_init', 'riverz_cr_register_settings' );
}
add_action( 'plugins_loaded', 'riverz_cr_boot' );

/** Declara compatibilidad con el almacenamiento de pedidos en tablas propias (HPOS). */
add_action( 'before_woocommerce_init', function () {
	if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
			'custom_order_tables',
			__FILE__,
			true
		);
	}
} );

// ─── Ajustes ─────────────────────────────────────────────────────────

function riverz_cr_settings() {
	$defaults = array(
		'endpoint' => 'https://riverz.co',
		'secret'   => '',
		'enabled'  => 'yes',
	);
	$saved = get_option( RIVERZ_CR_OPTION, array() );
	return wp_parse_args( is_array( $saved ) ? $saved : array(), $defaults );
}

function riverz_cr_admin_menu() {
	add_submenu_page(
		'woocommerce',
		__( 'Riverz — Recuperación de carritos', 'riverz-cart-recovery' ),
		__( 'Riverz', 'riverz-cart-recovery' ),
		'manage_woocommerce',
		'riverz-cart-recovery',
		'riverz_cr_settings_page'
	);
}

function riverz_cr_register_settings() {
	register_setting(
		'riverz_cr',
		RIVERZ_CR_OPTION,
		array( 'sanitize_callback' => 'riverz_cr_sanitize_settings' )
	);
}

function riverz_cr_sanitize_settings( $input ) {
	return array(
		'endpoint' => esc_url_raw( rtrim( trim( $input['endpoint'] ?? '' ), '/' ) ),
		'secret'   => trim( $input['secret'] ?? '' ),
		'enabled'  => ( ( $input['enabled'] ?? '' ) === 'yes' ) ? 'yes' : 'no',
	);
}

function riverz_cr_settings_page() {
	$s = riverz_cr_settings();
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Riverz — Recuperación de carritos', 'riverz-cart-recovery' ); ?></h1>
		<p>
			<?php esc_html_e( 'Copia el secreto desde Riverz: Ajustes → Canales → WooCommerce.', 'riverz-cart-recovery' ); ?>
		</p>
		<form method="post" action="options.php">
			<?php settings_fields( 'riverz_cr' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="riverz_cr_enabled"><?php esc_html_e( 'Activo', 'riverz-cart-recovery' ); ?></label></th>
					<td>
						<input type="checkbox" id="riverz_cr_enabled" name="<?php echo esc_attr( RIVERZ_CR_OPTION ); ?>[enabled]" value="yes" <?php checked( $s['enabled'], 'yes' ); ?> />
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="riverz_cr_endpoint"><?php esc_html_e( 'Dirección de Riverz', 'riverz-cart-recovery' ); ?></label></th>
					<td>
						<input type="url" class="regular-text" id="riverz_cr_endpoint" name="<?php echo esc_attr( RIVERZ_CR_OPTION ); ?>[endpoint]" value="<?php echo esc_attr( $s['endpoint'] ); ?>" />
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="riverz_cr_secret"><?php esc_html_e( 'Secreto', 'riverz-cart-recovery' ); ?></label></th>
					<td>
						<input type="password" class="regular-text" id="riverz_cr_secret" name="<?php echo esc_attr( RIVERZ_CR_OPTION ); ?>[secret]" value="<?php echo esc_attr( $s['secret'] ); ?>" autocomplete="new-password" />
						<p class="description"><?php esc_html_e( 'Firma cada aviso. Sin él, Riverz los rechaza.', 'riverz-cart-recovery' ); ?></p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}

// ─── Captura en el checkout ──────────────────────────────────────────

function riverz_cr_enqueue() {
	if ( ! function_exists( 'is_checkout' ) || ! is_checkout() ) {
		return;
	}
	$s = riverz_cr_settings();
	if ( $s['enabled'] !== 'yes' || empty( $s['secret'] ) ) {
		return;
	}

	wp_enqueue_script(
		'riverz-cr',
		plugins_url( 'assets/riverz-checkout.js', __FILE__ ),
		array(),
		RIVERZ_CR_VERSION,
		true
	);
	wp_localize_script( 'riverz-cr', 'riverzCR', array(
		'url'   => esc_url_raw( rest_url( 'riverz/v1/cart' ) ),
		'nonce' => wp_create_nonce( 'wp_rest' ),
	) );
}

function riverz_cr_register_routes() {
	register_rest_route( 'riverz/v1', '/cart', array(
		'methods'  => 'POST',
		'callback' => 'riverz_cr_capture',
		// Ruta pública a propósito: quien abandona el checkout casi nunca
		// tiene sesión iniciada. No expone nada — solo lee el carrito de
		// SU propia sesión y lo reenvía a Riverz.
		'permission_callback' => '__return_true',
		'args' => array(
			'email' => array( 'required' => false ),
			'phone' => array( 'required' => false ),
		),
	) );
}

/**
 * Token estable por sesión de compra. Se guarda en la sesión de
 * WooCommerce para que las sucesivas capturas del mismo comprador
 * actualicen SU carrito en lugar de crear uno nuevo con cada tecla.
 */
function riverz_cr_token() {
	if ( ! WC()->session ) {
		return '';
	}
	$token = WC()->session->get( RIVERZ_CR_TOKEN_KEY );
	if ( ! $token ) {
		$token = wp_generate_password( 32, false, false );
		WC()->session->set( RIVERZ_CR_TOKEN_KEY, $token );
	}
	return $token;
}

/** Foto del carrito, leída del servidor. Nunca de lo que manda el navegador. */
function riverz_cr_cart_snapshot() {
	$items = array();
	$restore = array();

	foreach ( WC()->cart->get_cart() as $item ) {
		$product = isset( $item['data'] ) ? $item['data'] : null;
		if ( ! $product ) {
			continue;
		}
		$image_id = $product->get_image_id();
		$items[] = array(
			'name'         => $product->get_name(),
			'quantity'     => (int) $item['quantity'],
			'price'        => wc_get_price_to_display( $product ),
			'product_id'   => (int) $item['product_id'],
			'variation_id' => (int) ( $item['variation_id'] ?? 0 ),
			'image'        => $image_id ? wp_get_attachment_url( $image_id ) : '',
		);
		$restore[] = array(
			'product_id'   => (int) $item['product_id'],
			'quantity'     => (int) $item['quantity'],
			'variation_id' => (int) ( $item['variation_id'] ?? 0 ),
			'variation'    => isset( $item['variation'] ) && is_array( $item['variation'] ) ? $item['variation'] : array(),
		);
	}

	return array( 'items' => $items, 'restore' => $restore );
}

function riverz_cr_capture( WP_REST_Request $request ) {
	$s = riverz_cr_settings();
	if ( $s['enabled'] !== 'yes' || empty( $s['secret'] ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'reason' => 'disabled' ), 200 );
	}
	if ( ! WC()->cart || WC()->cart->is_empty() ) {
		return new WP_REST_Response( array( 'ok' => false, 'reason' => 'empty' ), 200 );
	}

	$email = sanitize_email( (string) $request->get_param( 'email' ) );
	$phone = trim( (string) $request->get_param( 'phone' ) );

	// Sin forma de contactar, el aviso no sirve para nada: no lo mandamos.
	// Es también lo que evita generar ruido con cada visita anónima.
	if ( empty( $email ) && empty( $phone ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'reason' => 'no_contact' ), 200 );
	}

	$token = riverz_cr_token();
	if ( empty( $token ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'reason' => 'no_session' ), 200 );
	}

	$snapshot = riverz_cr_cart_snapshot();

	// Guardamos lo necesario para restaurar el carrito cuando la persona
	// vuelva por el link. Se guarda del lado del servidor: el link solo
	// lleva el token, así que no se puede manipular lo que se restaura.
	set_transient( 'riverz_cr_' . $token, $snapshot['restore'], RIVERZ_CR_TTL );

	$created = WC()->session->get( 'riverz_cr_started_at' );
	if ( ! $created ) {
		$created = gmdate( 'c' );
		WC()->session->set( 'riverz_cr_started_at', $created );
	}

	$name = trim(
		(string) $request->get_param( 'first_name' ) . ' ' . (string) $request->get_param( 'last_name' )
	);

	$payload = array(
		'cart_token'   => $token,
		'email'        => $email ?: null,
		'phone'        => $phone ?: null,
		'name'         => $name ?: null,
		'country'      => sanitize_text_field( (string) $request->get_param( 'country' ) ) ?: null,
		'currency'     => get_woocommerce_currency(),
		'total'        => WC()->cart->get_total( 'edit' ),
		'recovery_url' => add_query_arg( 'riverz_recover', $token, home_url( '/' ) ),
		'created_at'   => $created,
		'items'        => $snapshot['items'],
	);

	riverz_cr_send( $payload );

	return new WP_REST_Response( array( 'ok' => true ), 200 );
}

/**
 * El carrito se convirtió en pedido: avisamos para que Riverz lo cierre.
 * Sin esto, alguien que compró igual recibiría el recordatorio de
 * "dejaste tu compra a medias" un par de horas después.
 */
function riverz_cr_on_order_created( $order_id ) {
	if ( ! WC()->session ) {
		return;
	}
	$token = WC()->session->get( RIVERZ_CR_TOKEN_KEY );
	if ( empty( $token ) ) {
		return;
	}
	riverz_cr_send( array( 'cart_token' => $token, 'completed' => true ) );
	delete_transient( 'riverz_cr_' . $token );
	WC()->session->set( RIVERZ_CR_TOKEN_KEY, null );
	WC()->session->set( 'riverz_cr_started_at', null );
}

// ─── Restaurar el carrito desde el link ──────────────────────────────

/**
 * `?riverz_recover=<token>` vuelve a armar el carrito y manda al
 * checkout. Es lo que hace que el mensaje de recuperación termine en una
 * compra y no en una tienda vacía.
 */
function riverz_cr_maybe_restore_cart() {
	if ( empty( $_GET['riverz_recover'] ) || is_admin() ) {
		return;
	}
	// Sanitizamos con la misma forma que generamos (alfanumérico), así un
	// token manipulado no llega siquiera a tocar la base.
	$token = preg_replace( '/[^A-Za-z0-9]/', '', wp_unslash( $_GET['riverz_recover'] ) );
	if ( empty( $token ) ) {
		return;
	}

	$restore = get_transient( 'riverz_cr_' . $token );
	if ( empty( $restore ) || ! is_array( $restore ) ) {
		// Carrito vencido o ya usado: mandamos a la tienda sin romper nada.
		wp_safe_redirect( wc_get_page_permalink( 'shop' ) );
		exit;
	}

	if ( ! WC()->cart ) {
		return;
	}
	WC()->cart->empty_cart();
	foreach ( $restore as $line ) {
		WC()->cart->add_to_cart(
			(int) $line['product_id'],
			max( 1, (int) $line['quantity'] ),
			(int) ( $line['variation_id'] ?? 0 ),
			is_array( $line['variation'] ?? null ) ? $line['variation'] : array()
		);
	}

	// Reusamos el token para que, si vuelve a abandonar, siga siendo el
	// mismo carrito y no se dupliquen los avisos.
	if ( WC()->session ) {
		WC()->session->set( RIVERZ_CR_TOKEN_KEY, $token );
	}

	wp_safe_redirect( wc_get_checkout_url() );
	exit;
}

// ─── Envío firmado ───────────────────────────────────────────────────

/**
 * Manda el aviso a Riverz firmado igual que los webhooks nativos de
 * WooCommerce: base64 de HMAC-SHA256 sobre el cuerpo, con el secreto por
 * tienda. Reusar ese esquema evita que el comercio tenga que administrar
 * una segunda credencial.
 *
 * No bloqueante: el checkout del comprador no puede quedar esperando a
 * que responda un servidor externo.
 */
function riverz_cr_send( array $payload ) {
	$s = riverz_cr_settings();
	if ( empty( $s['endpoint'] ) || empty( $s['secret'] ) ) {
		return;
	}

	$body = wp_json_encode( $payload );
	if ( false === $body ) {
		return;
	}
	$signature = base64_encode( hash_hmac( 'sha256', $body, $s['secret'], true ) );

	wp_remote_post( $s['endpoint'] . '/api/woocommerce/webhooks/cart', array(
		'method'   => 'POST',
		'timeout'  => 5,
		'blocking' => false,
		'headers'  => array(
			'Content-Type'             => 'application/json',
			'X-WC-Webhook-Signature'   => $signature,
			// Mismo header con el que WooCommerce identifica la tienda en
			// sus webhooks nativos, para que Riverz resuelva la conexión
			// por un solo camino.
			'X-WC-Webhook-Source'      => home_url( '/' ),
			'User-Agent'               => 'Riverz-Cart-Recovery/' . RIVERZ_CR_VERSION,
		),
		'body'     => $body,
	) );
}
